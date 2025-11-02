import os
import re
from typing import List, Optional

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


def parse_refined_transcript(refined_text: str, original_segments: List[TranscriptSegment]) -> List[TranscriptSegment]:
    """Parse refined transcript back into segments, preserving original timestamps.

    The refined text should have format: [timestamp] text (one segment per line).
    Each line represents one segment.
    """
    lines = refined_text.strip().split("\n")
    refined_segments = []

    for i, line in enumerate(lines):
        if i >= len(original_segments):
            break

        # Extract timestamp and text from line
        timestamp_match = re.match(r"\[([^\]]+)\]\s*(.*)", line)

        if timestamp_match:
            orig_seg = original_segments[i]
            refined_text_only = timestamp_match.group(2).strip()

            refined_segments.append(
                TranscriptSegment(
                    text=refined_text_only,
                    startMs=orig_seg.startMs,  # Preserve original timestamps
                    endMs=orig_seg.endMs,
                    startTimeText=orig_seg.startTimeText,
                )
            )
        else:
            # Fallback: use original segment if parsing fails
            orig_seg = original_segments[i]
            refined_segments.append(
                TranscriptSegment(
                    text=line.strip(),
                    startMs=orig_seg.startMs,
                    endMs=orig_seg.endMs,
                    startTimeText=orig_seg.startTimeText,
                )
            )

    return refined_segments


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
    # Get video data
    video_url = "https://www.youtube.com/watch?v=MaBasS6vJ18"
    video = get_video_data(video_url)

    print(f"Title: {video.title}\n")
    print(f"Description: {video.description}\n")
    print(f"Number of transcript segments: {len(video.transcript) if video.transcript else 0}\n")
    print("=" * 80)
    print("FULL ORIGINAL TRANSCRIPT:")
    print("=" * 80)
    if video.transcript:
        for seg in video.transcript:
            print(f"[{seg.startTimeText}] {seg.text}")

    # Setup LLM
    api_key = os.getenv("OPENROUTER_API_KEY")
    llm = ChatOpenAI(
        model="x-ai/grok-code-fast-1",
        temperature=0,
        api_key=api_key,
        base_url="https://openrouter.ai/api/v1",
    )

    # Test with first 20 segments
    num_test_segments = 20
    test_segments = video.transcript[:num_test_segments] if video.transcript else []

    # Format transcript as simple text (one segment per line)
    transcript_text = format_transcript_segments(test_segments)

    # System prompt with title and description context
    system_prompt = f"""You are correcting a YouTube video transcript. Use the full contextual understanding to ground your corrections, especially for special terms.

Video Title: {video.title}
Video Description: {video.description}

CRITICAL CONSTRAINTS:
1. Only fix typos and grammar errors. Do NOT change the meaning or structure.
2. PRESERVE ALL NEWLINES - each line represents a separate transcript segment.
3. PRESERVE TIMESTAMPS - keep the [timestamp] format exactly as shown.
4. Do NOT merge lines together - keep the same number of lines.
5. Keep text length similar to original - don't make sentences too long or short.
6. If a sentence is broken across lines, keep it broken - only fix typos/grammar within each line."""

    # User message with transcript
    user_prompt = f"""Refine the following transcript by fixing typos and grammar errors. Preserve all newlines and timestamps exactly as shown.

Transcript:
{transcript_text}

Return the refined transcript with the same number of lines and timestamps preserved."""

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]

    # Show original formatted transcript
    print("=" * 80)
    print("ORIGINAL FORMATTED TRANSCRIPT (sent to model):")
    print("=" * 80)
    print(transcript_text)
    print("\n" + "=" * 80)

    # Get refined text (simple string output)
    refined_text = llm.invoke(messages).content

    print("=" * 80)
    print("FULL REFINED TRANSCRIPT (from model):")
    print("=" * 80)
    print(refined_text)
    print("\n" + "=" * 80)

    # Parse refined text back into segments
    refined_segments = parse_refined_transcript(refined_text, test_segments)

    print(f"\nParsed {len(refined_segments)} refined segments")
    print("=" * 80)
    print("PARSED REFINED SEGMENTS:")
    print("=" * 80)
    for i, seg in enumerate(refined_segments, 1):
        print(f"{i}. [{seg.startTimeText}] {seg.text}")
        print(f"   Timestamps: {seg.startMs}ms - {seg.endMs}ms")

    # Compare original vs refined segments
    compare_segments(test_segments, refined_segments, transcript_text, refined_text)


if __name__ == "__main__":
    main()
