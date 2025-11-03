import math
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
    api_key = os.getenv("SCRAPECREATORS_API_KEY")
    api_url = f"https://api.scrapecreators.com/v1/youtube/video?url={youtube_url}&get_transcript=true"
    headers = {"x-api-key": api_key}

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
    """
    lines = refined_text.strip().split("\n") if refined_text is not None else []
    refined_segments: List[TranscriptSegment] = []

    # Ensure we always return one refined segment per original segment.
    for i in range(len(original_segments)):
        line = lines[i] if i < len(lines) else ""

        # Extract timestamp and text from line (if timestamps are present). Otherwise, use index mapping.
        timestamp_match = re.match(r"\[([^\]]+)\]\s*(.*)", line)

        orig_seg = original_segments[i]
        if timestamp_match:
            refined_text_only = timestamp_match.group(2).strip()
        else:
            refined_text_only = line.strip() if line.strip() else orig_seg.text

        refined_segments.append(
            TranscriptSegment(
                text=refined_text_only,
                startMs=orig_seg.startMs,  # Preserve original timestamps
                endMs=orig_seg.endMs,
                startTimeText=orig_seg.startTimeText,
            )
        )

    return refined_segments


# --- Token estimation and chunking utilities ---
def chunk_segments_by_token_limit(
    segments: List[TranscriptSegment],
    token_limit: int,
    system_prompt: str,
    preamble_text: str,
) -> List[Tuple[int, int]]:
    """Chunk segments ensuring (overhead + chunk_text_tokens) <= token_limit.

    Returns list of (start_idx, end_idx) ranges where end_idx is exclusive.
    Rounds down to segment boundaries; a segment that doesn't fit starts the next chunk.
    """
    # Compute overhead tokens (inline estimate_tokens and compute_overhead_text)
    overhead_tokens = (int(math.ceil(len(system_prompt) / 4)) if system_prompt else 0) + (int(math.ceil(len(preamble_text) / 4)) if preamble_text else 0)

    if overhead_tokens >= token_limit:
        # Degenerate case: overhead exceeds limit; still try to send one segment per chunk
        available_tokens = 0
    else:
        available_tokens = token_limit - overhead_tokens

    ranges: List[Tuple[int, int]] = []
    start = 0
    n = len(segments)
    while start < n:
        current_tokens = 0
        end = start
        while end < n:
            # Normalize segment text (inline normalize_segment_text)
            seg_text = " ".join((segments[end].text or "").split()) + "\n"
            # Estimate tokens (inline estimate_tokens)
            seg_tokens = int(math.ceil(len(seg_text) / 4)) if seg_text else 0

            if current_tokens == 0 and seg_tokens > available_tokens:
                # Force at least one segment even if it individually exceeds budget
                end += 1
                break
            if current_tokens + seg_tokens > available_tokens:
                break
            current_tokens += seg_tokens
            end += 1

        # Add range [start, end)
        if end == start:
            # Safety: ensure progress
            end = min(start + 1, n)
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
    api_key = os.getenv("OPENROUTER_API_KEY")
    llm = ChatOpenAI(
        model="x-ai/grok-code-fast-1",
        temperature=0,
        api_key=api_key,
        base_url="https://openrouter.ai/api/v1",
        use_responses_api=True,
        reasoning={"effort": "low"},
    )

    # Prompts: system + preamble
    system_prompt = "You are correcting a YouTube video transcript. Use the video title and description for context.\n" "CRITICAL CONSTRAINTS:\n" "1. Only fix typos and grammar. Do NOT change meaning or structure.\n" "2. PRESERVE ALL NEWLINES: each line is a distinct transcript segment.\n" "3. Do NOT add, remove, or merge lines. Keep the same number of lines.\n" "4. Do NOT include timestamps in your output. Output ONLY refined text lines.\n" "5. Keep text length similar; do not over-extend or truncate content.\n" "6. If a sentence is broken across lines, keep it broken the same way."

    def user_preamble(title: Optional[str], description: Optional[str]) -> str:
        parts = [
            f"Video Title: {title or ''}",
            f"Video Description: {description or ''}",
            "",
            "Refine the following transcript chunk. Return ONLY the corrected lines in the same order.",
            "Do NOT include timestamps. Output must have exactly the same number of lines.",
            "",
            "Transcript Chunk:",
        ]
        return "\n".join(parts)

    preamble_text = user_preamble(video.title, video.description)

    # Chunking by token limit (approx 1 token ≈ 4 chars) with a 4k-token budget including overhead
    TOKEN_LIMIT = 4096
    ranges = chunk_segments_by_token_limit(video.transcript, TOKEN_LIMIT, system_prompt, preamble_text)

    all_refined_lines: List[str] = []

    for start_idx, end_idx in ranges:
        chunk_segments = video.transcript[start_idx:end_idx]
        chunk_text_only = "\n".join(" ".join((seg.text or "").split()) for seg in chunk_segments)

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"{preamble_text}\n{chunk_text_only}"),
        ]

        response = llm.invoke(messages)
        refined_text = response.content_blocks[-1]["text"]
        refined_lines = refined_text.strip().split("\n")
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
        video_url = "https://www.youtube.com/watch?v=MaBasS6vJ18"
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
