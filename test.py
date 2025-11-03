import os
import re
import sys
from typing import List, Optional, Tuple

import requests
from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

load_dotenv()


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

    The refined text should have format: [timestamp] text (one segment per line).
    Each line represents one segment.

    First normalizes newlines within each segment, then maps strictly by index.
    """
    if not refined_text:
        return []

    # Split by newline to get potential lines
    raw_lines = refined_text.strip().split("\n")

    # Normalize each line: remove internal newlines and normalize whitespace
    # This handles cases where a single segment might have been split across multiple lines
    # Preserve all lines (including empty ones) to maintain strict index mapping
    normalized_lines = []
    for raw_line in raw_lines:
        # Remove any internal newlines and normalize whitespace
        # This collapses any newlines within what should be a single segment
        normalized = " ".join(raw_line.split())
        normalized_lines.append(normalized)  # Keep empty lines to preserve index mapping

    # Log parsing details for debugging
    if len(normalized_lines) != len(original_segments):
        print(f"  ⚠️  Parser warning: Expected {len(original_segments)} lines, got {len(normalized_lines)} lines")
        print(f"     First few original segments: {[s.text[:30] for s in original_segments[:3]]}")
        print(f"     First few normalized lines: {[l[:30] for l in normalized_lines[:3]]}")

    refined_segments: List[TranscriptSegment] = []

    # Ensure we always return one refined segment per original segment.
    # Map strictly by index, regardless of timestamps in the text.
    for i in range(len(original_segments)):
        # Get the corresponding line by index
        line = normalized_lines[i] if i < len(normalized_lines) else ""

        # Extract text from line (remove timestamp if present, but don't rely on it for mapping)
        timestamp_match = re.match(r"\[([^\]]+)\]\s*(.*)", line)

        orig_seg = original_segments[i]
        if timestamp_match:
            # Extract text after timestamp
            refined_text_only = timestamp_match.group(2).strip()
        else:
            # No timestamp, use the whole line (after normalization)
            refined_text_only = line.strip() if line.strip() else orig_seg.text

        # Ensure we have text - fallback to original if empty
        if not refined_text_only:
            refined_text_only = orig_seg.text

        refined_segments.append(
            TranscriptSegment(
                text=refined_text_only,
                startMs=orig_seg.startMs,  # Preserve original timestamps strictly
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

    # Chunking by segment count: max 100 segments per chunk
    MAX_SEGMENTS_PER_CHUNK = 100
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
