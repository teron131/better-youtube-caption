import os
import re
import sys
from typing import List, Optional, Tuple

import difflib
import requests
from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

load_dotenv()


# Shared chunking configuration and boundaries
MAX_SEGMENTS_PER_CHUNK = 100
CHUNK_SENTINEL = "<<<__CHUNK_END__>>>"


class TranscriptSegment(BaseModel):
    text: str
    startMs: str
    endMs: str
    startTimeText: str


class Video(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    transcript: Optional[List[TranscriptSegment]] = None
    transcript_only_text: Optional[str] = None


def get_video_data(youtube_url: str) -> Video:
    """Get video data including transcript segments, title, and description."""
    api_url = f"https://api.scrapecreators.com/v1/youtube/video?url={youtube_url}&get_transcript=true"
    headers = {"x-api-key": os.getenv("SCRAPECREATORS_API_KEY")}

    response = requests.get(api_url, headers=headers)
    response.raise_for_status()

    data = response.json()

    # Parse transcript segments
    transcript_segments = None
    if data.get("transcript") and isinstance(data["transcript"], list):
        transcript_segments = [
            TranscriptSegment(
                text=seg.get("text", ""),
                startMs=seg.get("startMs", ""),
                endMs=seg.get("endMs", ""),
                startTimeText=seg.get("startTimeText", ""),
            )
            for seg in data["transcript"]
        ]

    return Video(
        title=data.get("title"),
        description=data.get("description"),
        transcript=transcript_segments,
        transcript_only_text=data.get("transcript_only_text"),
    )


def format_transcript_segments(segments: List[TranscriptSegment]) -> str:
    """Format transcript segments as newline-separated text.

    Removes internal newlines from each segment and joins with spaces,
    so each segment is exactly one line.
    """
    formatted_segments = []
    for seg in segments:
        # Remove internal newlines and normalize whitespace
        normalized_text = " ".join(seg.text.split())
        formatted_segments.append(f"[{seg.startTimeText}] {normalized_text}")
    return "\n".join(formatted_segments)


def parse_refined_transcript(
    refined_text: str,
    original_segments: List[TranscriptSegment],
) -> List[TranscriptSegment]:
    """Parse refined transcript back into segments, preserving original timestamps.

    Uses length-based matching with 20% tolerance to be more resilient to misalignments.
    Falls back to index-based mapping if length matching fails.
    """
    if not refined_text:
        return []

    # If we have explicit chunk sentinels, align per chunk to prevent cross-chunk drift
    if CHUNK_SENTINEL in refined_text:
        # Split refined text into chunk blocks by sentinel lines
        raw_blocks = refined_text.split(CHUNK_SENTINEL)
        # Compute original chunk ranges identically to generation
        ranges = chunk_segments_by_count(original_segments, MAX_SEGMENTS_PER_CHUNK)
        if len(raw_blocks) < len(ranges):
            # Pad missing blocks as empty to trigger original fallbacks in those chunks
            raw_blocks += [""] * (len(ranges) - len(raw_blocks))

        def normalize_to_texts(block_text: str) -> List[str]:
            lines = [" ".join(x.split()) for x in block_text.strip().split("\n") if x is not None]
            texts: List[str] = []
            for ln in lines:
                m = re.match(r"\[([^\]]+)\]\s*(.*)", ln)
                texts.append(m.group(2).strip() if m else ln.strip())
            # Remove trailing empties
            return [t for t in texts if t != ""]

        def dp_align(orig_chunk: List[TranscriptSegment], refined_texts_chunk: List[str]) -> List[TranscriptSegment]:
            # Local DP identical to the global method, but bounded to this chunk
            n_o = len(orig_chunk)
            n_r = len(refined_texts_chunk)
            if n_o == 0:
                return []

            def line_similarity(a: str, b: str) -> float:
                if not a or not b:
                    return 0.0
                char_ratio = difflib.SequenceMatcher(None, a, b).ratio()
                a_tokens = set(re.findall(r"[A-Za-z0-9']+", a.lower()))
                b_tokens = set(re.findall(r"[A-Za-z0-9']+", b.lower()))
                jacc = (len(a_tokens & b_tokens) / len(a_tokens | b_tokens)) if (a_tokens and b_tokens) else 0.0
                return 0.7 * char_ratio + 0.3 * jacc

            GAP_O = -0.30
            GAP_R = -0.30
            dp = [[float("-inf")] * (n_r + 1) for _ in range(n_o + 1)]
            back = [[None] * (n_r + 1) for _ in range(n_o + 1)]
            dp[0][0] = 0.0
            for i in range(1, n_o + 1):
                dp[i][0] = dp[i - 1][0] + GAP_O
                back[i][0] = "O"
            for j in range(1, n_r + 1):
                dp[0][j] = dp[0][j - 1] + GAP_R
                back[0][j] = "R"
            for i in range(1, n_o + 1):
                a = orig_chunk[i - 1].text
                for j in range(1, n_r + 1):
                    b = refined_texts_chunk[j - 1]
                    best_score = dp[i - 1][j - 1] + line_similarity(a, b)
                    best_ptr = "M"
                    o_score = dp[i - 1][j] + GAP_O
                    if o_score > best_score:
                        best_score = o_score
                        best_ptr = "O"
                    r_score = dp[i][j - 1] + GAP_R
                    if r_score > best_score:
                        best_score = r_score
                        best_ptr = "R"
                    dp[i][j] = best_score
                    back[i][j] = best_ptr
            # Backtrack
            mapping: List[Optional[int]] = [None] * n_o
            i, j = n_o, n_r
            while i > 0 or j > 0:
                ptr = back[i][j] if i >= 0 and j >= 0 else None
                if ptr == "M" and i > 0 and j > 0:
                    mapping[i - 1] = j - 1
                    i -= 1
                    j -= 1
                elif ptr == "O" and i > 0:
                    mapping[i - 1] = None
                    i -= 1
                elif ptr == "R" and j > 0:
                    j -= 1
                else:
                    if i > 0:
                        mapping[i - 1] = None
                        i -= 1
                    elif j > 0:
                        j -= 1
                    else:
                        break

            # Build refined chunk with a tail guard (last 5 lines must be within 20%)
            refined_chunk: List[TranscriptSegment] = []
            tail_guard = 5
            for idx, oseg in enumerate(orig_chunk):
                ref_idx = mapping[idx]
                if ref_idx is not None and 0 <= ref_idx < n_r:
                    text_candidate = refined_texts_chunk[ref_idx]
                else:
                    text_candidate = oseg.text
                # Tail guard
                if idx >= len(orig_chunk) - tail_guard:
                    o_len = len(oseg.text) or 1
                    if abs(len(text_candidate) - o_len) / o_len > 0.20:
                        text_candidate = oseg.text
                if not text_candidate:
                    text_candidate = oseg.text
                refined_chunk.append(
                    TranscriptSegment(
                        text=text_candidate,
                        startMs=oseg.startMs,
                        endMs=oseg.endMs,
                        startTimeText=oseg.startTimeText,
                    )
                )
            return refined_chunk

        # Build per-chunk alignment
        final_segments: List[TranscriptSegment] = []
        for (start_idx, end_idx), block_text in zip(ranges, raw_blocks):
            orig_chunk = original_segments[start_idx:end_idx]
            refined_texts_chunk = normalize_to_texts(block_text)
            # Debug if mismatch
            if len(refined_texts_chunk) != len(orig_chunk):
                print(f"  ⚠️  Parser chunk warning: expected {len(orig_chunk)} lines, got {len(refined_texts_chunk)}")
            final_segments.extend(dp_align(orig_chunk, refined_texts_chunk))
        return final_segments

    # No sentinels -> fall back to global alignment
    # Split by newline to get potential lines
    raw_lines = refined_text.strip().split("\n")

    # Normalize each line: remove internal newlines and normalize whitespace
    normalized_lines = []
    for raw_line in raw_lines:
        normalized = " ".join(raw_line.split())
        normalized_lines.append(normalized)

    # Extract text-only from each normalized line (remove timestamps)
    refined_texts = []
    for line in normalized_lines:
        timestamp_match = re.match(r"\[([^\]]+)\]\s*(.*)", line)
        if timestamp_match:
            refined_texts.append(timestamp_match.group(2).strip())
        else:
            refined_texts.append(line.strip())

    # Log parsing details for debugging
    if len(refined_texts) != len(original_segments):
        print(f"  ⚠️  Parser warning: Expected {len(original_segments)} lines, got {len(refined_texts)} lines")

    # Global DP alignment (monotonic) to robustly map originals to refined lines
    n_orig = len(original_segments)
    n_ref = len(refined_texts)
    if n_orig == 0:
        return []

    def line_similarity(a: str, b: str) -> float:
        if not a or not b:
            return 0.0
        char_ratio = difflib.SequenceMatcher(None, a, b).ratio()
        a_tokens = set(re.findall(r"[A-Za-z0-9']+", a.lower()))
        b_tokens = set(re.findall(r"[A-Za-z0-9']+", b.lower()))
        jacc = (len(a_tokens & b_tokens) / len(a_tokens | b_tokens)) if (a_tokens and b_tokens) else 0.0
        return 0.7 * char_ratio + 0.3 * jacc

    GAP_ORIG = -0.30  # fallback to original text for an unmatched original
    GAP_REF = -0.30  # skip an extra refined line

    # DP matrices
    dp = [[float("-inf")] * (n_ref + 1) for _ in range(n_orig + 1)]
    back = [[None] * (n_ref + 1) for _ in range(n_orig + 1)]

    dp[0][0] = 0.0
    for i in range(1, n_orig + 1):
        dp[i][0] = dp[i - 1][0] + GAP_ORIG
        back[i][0] = "O"  # original gap (use original text)
    for j in range(1, n_ref + 1):
        dp[0][j] = dp[0][j - 1] + GAP_REF
        back[0][j] = "R"  # refined gap (skip refined line)

    for i in range(1, n_orig + 1):
        a = original_segments[i - 1].text
        for j in range(1, n_ref + 1):
            b = refined_texts[j - 1]
            # Match
            match_score = dp[i - 1][j - 1] + line_similarity(a, b)
            best_score = match_score
            best_ptr = "M"
            # Gap in original (use original text for this segment)
            o_score = dp[i - 1][j] + GAP_ORIG
            if o_score > best_score:
                best_score = o_score
                best_ptr = "O"
            # Gap in refined (skip this refined line)
            r_score = dp[i][j - 1] + GAP_REF
            if r_score > best_score:
                best_score = r_score
                best_ptr = "R"

            dp[i][j] = best_score
            back[i][j] = best_ptr

    # Backtrack to produce mapping of each original index to a refined index (or None)
    mapping: List[Optional[int]] = [None] * n_orig
    i, j = n_orig, n_ref
    while i > 0 or j > 0:
        ptr = back[i][j] if i >= 0 and j >= 0 else None
        if ptr == "M" and i > 0 and j > 0:
            mapping[i - 1] = j - 1
            i -= 1
            j -= 1
        elif ptr == "O" and i > 0:
            mapping[i - 1] = None
            i -= 1
        elif ptr == "R" and j > 0:
            j -= 1
        else:
            # Fallback safety
            if i > 0:
                mapping[i - 1] = None
                i -= 1
            elif j > 0:
                j -= 1
            else:
                break

    # Build refined segments preserving timestamps
    refined_segments: List[TranscriptSegment] = []
    for idx, orig_seg in enumerate(original_segments):
        ref_idx = mapping[idx]
        if ref_idx is not None and 0 <= ref_idx < n_ref:
            refined_text_only = refined_texts[ref_idx]
        else:
            refined_text_only = orig_seg.text
        if not refined_text_only:
            refined_text_only = orig_seg.text
        refined_segments.append(
            TranscriptSegment(
                text=refined_text_only,
                startMs=orig_seg.startMs,
                endMs=orig_seg.endMs,
                startTimeText=orig_seg.startTimeText,
            )
        )

    return refined_segments


# --- Segment count-based chunking utilities ---
def chunk_segments_by_count(
    segments: List[TranscriptSegment],
    max_segments_per_chunk: int,
) -> List[Tuple[int, int]]:
    """Chunk segments into groups of at most max_segments_per_chunk segments.

    Returns list of (start_idx, end_idx) ranges where end_idx is exclusive.
    Each chunk will have at most max_segments_per_chunk segments.
    """
    ranges: List[Tuple[int, int]] = []
    n = len(segments)
    start = 0

    while start < n:
        end = min(start + max_segments_per_chunk, n)
        ranges.append((start, end))
        start = end

    return ranges


def refine_transcript_with_llm(video: Video) -> str:
    """Refine video transcript using LLM inference.

    Takes a Video object and returns a multiline string ready to be parsed
    into List[TranscriptSegment]. The string format is one segment per line,
    optionally with timestamps: [timestamp] text

    Args:
        video: Video object containing transcript segments, title, and description

    Returns:
        Multiline string with refined transcript, ready for parsing into segments
    """
    if not video.transcript:
        return ""

    # Setup LLM
    llm = ChatOpenAI(
        model="google/gemini-2.5-flash-lite",
        temperature=0,
        api_key=os.getenv("OPENROUTER_API_KEY"),
        base_url="https://openrouter.ai/api/v1",
        use_responses_api=True,
        reasoning={"effort": "minimal"},
        extra_body={
            "include_reasoning": False,
            "provider": {"sort": "throughput"},
        },  # OpenRouter params
    )

    # Prompts: system + preamble
    system_prompt = """You are correcting segments of a YouTube video transcript. These segments could be from anywhere in the video (beginning, middle, or end). Use the video title and description for context.

CRITICAL CONSTRAINTS:
- Only fix typos and grammar. Do NOT change meaning or structure.
- PRESERVE ALL NEWLINES: each line is a distinct transcript segment.
- Do NOT add, remove, or merge lines. Keep the same number of lines.
- MAINTAIN SIMILAR LINE LENGTHS: Each output line should be approximately the same character count as its corresponding input line (±10% tolerance). Do NOT expand short lines into long paragraphs. Do NOT condense long lines significantly. Keep each line concise.
- If a sentence is broken across lines, keep it broken the same way.
- PRESERVE THE ORIGINAL LANGUAGE: output must be in the same language as the input transcript.
- Focus on minimal corrections: fix typos, correct grammar errors, but keep expansions/additions to an absolute minimum.

EXAMPLES OF CORRECT BEHAVIOR:

Input:
up to 900. From 900 up to 1,100.
If you sold at the reasonable
valuations, when the gains that already
been had, you missed out big time. I

Output:
up to $900. From $900 up to $1,100.
If you sold at the reasonable
valuations, when the gains that already
had been had, you missed out big time. I"""

    def user_preamble(title: Optional[str], description: Optional[str]) -> str:
        parts = [
            f"Video Title: {title or ''}",
            f"Video Description: {description or ''}",
            "",
            "Transcript Chunk:",
        ]
        return "\n".join(parts)

    preamble_text = user_preamble(video.title, video.description)

    # Chunking by segment count
    ranges = chunk_segments_by_count(video.transcript, MAX_SEGMENTS_PER_CHUNK)

    # Log chunk arrangement
    print(f"\n{'='*80}")
    print("CHUNK ARRANGEMENT")
    print(f"{'='*80}")
    print(f"Total segments: {len(video.transcript)}")
    print(f"Total chunks: {len(ranges)}")
    print(f"\nChunk details:")
    for chunk_idx, (start_idx, end_idx) in enumerate(ranges, 1):
        num_segments = end_idx - start_idx
        print(f"  Chunk {chunk_idx}: segments {start_idx}-{end_idx-1} (indices {start_idx}-{end_idx}, {num_segments} segments)")
    print(f"{'='*80}\n")

    # Prepare all messages for batch processing
    batch_messages = []
    chunk_info = []  # Store info about each chunk for logging

    for chunk_idx, (start_idx, end_idx) in enumerate(ranges, 1):
        chunk_segments = video.transcript[start_idx:end_idx]
        expected_line_count = len(chunk_segments)
        chunk_text_only = "\n".join(" ".join((seg.text or "").split()) for seg in chunk_segments)

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"{preamble_text}\n{chunk_text_only}"),
        ]

        batch_messages.append(messages)
        chunk_info.append(
            {
                "chunk_idx": chunk_idx,
                "start_idx": start_idx,
                "end_idx": end_idx,
                "expected_line_count": expected_line_count,
            }
        )

    # Process all chunks in parallel using batch
    print(f"Processing {len(batch_messages)} chunks in parallel...")
    responses = llm.batch(batch_messages)

    # Process responses
    all_refined_lines: List[str] = []
    for response, info in zip(responses, chunk_info):
        chunk_idx = info["chunk_idx"]
        expected_line_count = info["expected_line_count"]

        refined_text = response.content_blocks[-1]["text"]
        refined_lines = refined_text.strip().split("\n")
        actual_line_count = len(refined_lines)
        print(f"  Chunk {chunk_idx} completed: received {actual_line_count} lines (expected {expected_line_count})")
        if actual_line_count != expected_line_count:
            print(f"  ⚠️  WARNING: Line count mismatch in chunk {chunk_idx}!")
        all_refined_lines.extend(refined_lines)
        # Insert a sentinel line to preserve chunk boundaries for the parser
        all_refined_lines.append(CHUNK_SENTINEL)

    return "\n".join(all_refined_lines)


def compare_segments(test_segments: List[TranscriptSegment], refined_segments: List[TranscriptSegment], transcript_text: str, refined_text: str) -> None:
    """Compare original vs refined segments to verify timestamp preservation."""
    print("=" * 80)
    print("TIMESTAMP PRESERVATION CHECK")
    print("=" * 80)

    if test_segments and refined_segments:
        num_to_compare = min(len(test_segments), len(refined_segments))

        timestamp_matches = []
        text_length_changes = []

        for i in range(num_to_compare):
            orig = test_segments[i]
            refined = refined_segments[i]

            # Check timestamp matches (should all match since we preserve them programmatically)
            startMs_match = orig.startMs == refined.startMs
            endMs_match = orig.endMs == refined.endMs
            startTimeText_match = orig.startTimeText == refined.startTimeText

            timestamp_match = startMs_match and endMs_match and startTimeText_match
            timestamp_matches.append(timestamp_match)

            text_changed = orig.text.strip() != refined.text.strip()
            length_diff = len(refined.text) - len(orig.text)
            text_length_changes.append(length_diff)

            # Show full comparison for all segments
            print(f"\nSegment {i+1}:")
            print(f"  Timestamps Match: {timestamp_match}")
            if not timestamp_match:
                print(f"    startMs: '{orig.startMs}' vs '{refined.startMs}' - Match: {startMs_match}")
                print(f"    endMs: '{orig.endMs}' vs '{refined.endMs}' - Match: {endMs_match}")
                print(f"    startTimeText: '{orig.startTimeText}' vs '{refined.startTimeText}' - Match: {startTimeText_match}")
            print(f"  Original: [{orig.startTimeText}] {orig.text}")
            print(f"  Refined:   [{refined.startTimeText}] {refined.text}")
            print(f"  Text Changed: {text_changed}")
            if text_changed:
                print(f"    Original length: {len(orig.text)} chars")
                print(f"    Refined length:  {len(refined.text)} chars")
                print(f"    Length diff:     {length_diff:+d} chars")

        print("\n" + "=" * 80)
        print("SUMMARY:")
        print(f"  Segments sent: {len(test_segments)}")
        print(f"  Segments received: {len(refined_segments)}")
        print(f"  Segments compared: {num_to_compare}")
        print(f"  Timestamps preserved: {sum(timestamp_matches)}/{len(timestamp_matches)}")
        print(f"  Segment count match: {len(test_segments) == len(refined_segments)}")
        if text_length_changes:
            avg_length_change = sum(text_length_changes) / len(text_length_changes)
            max_length_change = max(abs(d) for d in text_length_changes)
            print(f"  Avg length change: {avg_length_change:+.1f} chars")
            print(f"  Max length change: {max_length_change} chars")

        # Show line count comparison (should match)
        original_lines = len(transcript_text.split("\n"))
        refined_lines = len(refined_text.strip().split("\n"))
        print(f"  Original lines: {original_lines}")
        print(f"  Refined lines: {refined_lines}")
        print(f"  Line count match: {original_lines == refined_lines}")
    else:
        print("No transcript segments to compare")


def main():
    """Main execution function."""
    # Clear and redirect output to output.log
    output_file = "output.log"
    original_stdout = sys.stdout

    try:
        # Open file in write mode to clear it, then redirect stdout
        log_file = open(output_file, "w", encoding="utf-8")
        sys.stdout = log_file

        # Get video data
        video_url = "https://www.youtube.com/watch?v=mV_EIjxpdKI"
        video = get_video_data(video_url)

        print(f"Title: {video.title}\n")
        print(f"Description: {video.description}\n")
        total_segments = len(video.transcript) if video.transcript else 0
        print(f"Number of transcript segments: {total_segments}\n")

        if not video.transcript:
            print("No transcript available.")
            return

        # Refine transcript using LLM
        refined_text = refine_transcript_with_llm(video)

        # Parse refined text back into segments
        all_refined_segments = parse_refined_transcript(refined_text, video.transcript)

        # Compare original vs refined across all processed segments
        original_text_for_all = format_transcript_segments(video.transcript)
        refined_text_for_all = format_transcript_segments(all_refined_segments)
        compare_segments(video.transcript, all_refined_segments, original_text_for_all, refined_text_for_all)
    finally:
        # Restore stdout and close file
        sys.stdout = original_stdout
        log_file.close()
        print(f"Output written to {output_file}")


if __name__ == "__main__":
    main()
