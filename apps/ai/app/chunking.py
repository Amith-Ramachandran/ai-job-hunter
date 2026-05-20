"""Text chunking for embeddings.

Two strategies:
- CV chunks: section-aware split on Markdown headings (## Experience, ## Skills, …)
  with a fallback to the recursive splitter for sections too large to embed in one shot.
- JD chunks: plain recursive character splitter — JDs rarely have rigid section structure.

Both produce chunks targeted at ~600 tokens with ~100 token overlap. Why those numbers:
- text-embedding-3-small accepts up to 8192 tokens but quality degrades beyond ~512–1000
  for retrieval tasks. ~600 is a sweet spot.
- 100-token overlap means a sentence straddling a chunk boundary still appears in full
  in at least one chunk — important so a query matching that sentence can find it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import tiktoken
from langchain_text_splitters import RecursiveCharacterTextSplitter

# We use the cl100k_base tokenizer for length measurement — close enough to
# text-embedding-3-small's tokenizer for our chunk-size targets. Exact token
# count for billing comes from the OpenAI API response itself.
_ENCODER = tiktoken.get_encoding("cl100k_base")

DEFAULT_CHUNK_TOKENS = 600
DEFAULT_CHUNK_OVERLAP = 100
# Soft limit — a single CV section larger than this gets re-split via the recursive splitter.
MAX_SECTION_TOKENS = 1200


@dataclass(frozen=True)
class Chunk:
    """One unit of embeddable text.

    `index` is the chunk's position within its parent document — used to build
    deterministic Qdrant point IDs so re-embedding overwrites cleanly.
    """

    index: int
    text: str
    token_count: int


def count_tokens(text: str) -> int:
    return len(_ENCODER.encode(text))


def _make_recursive_splitter(
    chunk_tokens: int = DEFAULT_CHUNK_TOKENS,
    chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
) -> RecursiveCharacterTextSplitter:
    """Splitter that walks paragraph → sentence → word → char until each chunk fits.

    Uses the tiktoken length function so chunk size is measured in tokens, not chars.
    """
    return RecursiveCharacterTextSplitter(
        chunk_size=chunk_tokens,
        chunk_overlap=chunk_overlap,
        length_function=count_tokens,
        separators=["\n\n", "\n", ". ", " ", ""],
    )


def chunk_jd(text: str) -> list[Chunk]:
    """Recursive split for job descriptions.

    JDs are usually free-form prose; trying to be section-aware would over-fit on
    one source's HTML conventions and break for others.
    """
    splitter = _make_recursive_splitter()
    pieces = splitter.split_text(text.strip())
    return [Chunk(index=i, text=p, token_count=count_tokens(p)) for i, p in enumerate(pieces) if p.strip()]


# Matches Markdown-style section headings. A CV converted to text often has
# patterns like "## Experience", "## Skills", "EDUCATION", etc.
_SECTION_HEADING = re.compile(
    r"^\s*(#{1,6}\s+\S.*|[A-Z][A-Z\s/&-]{2,40})\s*$",
    re.MULTILINE,
)


def chunk_cv(text: str) -> list[Chunk]:
    """Section-aware split for CVs.

    Splits the document on heading lines, then each section becomes its own chunk
    UNLESS it's larger than MAX_SECTION_TOKENS in which case it gets sub-split via
    the recursive splitter.

    Why per-section: CVs have meaningful structure (Experience, Skills, Education).
    A query like "5 years of Python" is much more likely to match a focused
    "Skills" chunk than a chunk that mixes Skills with the user's hobbies section.
    """
    text = text.strip()
    if not text:
        return []

    # Find heading positions.
    heading_starts = [m.start() for m in _SECTION_HEADING.finditer(text)]

    # If no headings detected, fall back to the JD strategy — better than one giant chunk.
    if not heading_starts:
        return chunk_jd(text)

    # Build (start, end) ranges per section. Prepend 0 so anything before the first
    # heading (header lines, contact info) becomes its own chunk too.
    boundaries = sorted({0, *heading_starts, len(text)})
    section_texts: list[str] = []
    for start, end in zip(boundaries, boundaries[1:], strict=False):
        section = text[start:end].strip()
        if section:
            section_texts.append(section)

    # Sub-split sections that are too long.
    splitter = _make_recursive_splitter()
    chunks: list[Chunk] = []
    next_idx = 0
    for section in section_texts:
        if count_tokens(section) <= MAX_SECTION_TOKENS:
            chunks.append(
                Chunk(index=next_idx, text=section, token_count=count_tokens(section))
            )
            next_idx += 1
        else:
            for piece in splitter.split_text(section):
                if not piece.strip():
                    continue
                chunks.append(
                    Chunk(index=next_idx, text=piece, token_count=count_tokens(piece))
                )
                next_idx += 1

    return chunks
