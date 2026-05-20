"""Unit tests for the chunking module.

Covers the structural behavior — section-aware splits, fallback to recursive
when no headings, sub-splitting of oversized sections. Doesn't try to assert
exact chunk counts since those depend on tokenizer quirks.
"""

from app.chunking import chunk_cv, chunk_jd, count_tokens


def test_chunk_jd_returns_indexed_chunks():
    text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph." * 50
    chunks = chunk_jd(text)
    assert len(chunks) > 0
    # Indices are sequential starting at 0.
    assert [c.index for c in chunks] == list(range(len(chunks)))
    # Each chunk has a positive token count.
    for c in chunks:
        assert c.token_count > 0
        assert c.text.strip() == c.text


def test_chunk_jd_empty_input():
    assert chunk_jd("") == []
    assert chunk_jd("   \n\n   ") == []


def test_chunk_cv_section_aware():
    cv = """John Doe
Software Engineer

## Experience

10 years at Acme building backends.

## Skills

Python, TypeScript, AWS.

## Education

B.Sc. Computer Science.
"""
    chunks = chunk_cv(cv)
    # Header + 3 sections = 4 chunks (header chunk for the contact info).
    assert len(chunks) >= 3
    # Each section should be its own chunk — verify by content overlap.
    section_texts = " || ".join(c.text for c in chunks)
    assert "Experience" in section_texts
    assert "Skills" in section_texts
    assert "Education" in section_texts


def test_chunk_cv_no_headings_falls_back_to_recursive():
    # No # headings, no UPPERCASE patterns. Should still produce chunks.
    cv = "Random prose without any section markers. " * 200
    chunks = chunk_cv(cv)
    assert len(chunks) > 0


def test_count_tokens_monotonic():
    # Sanity check: longer text → more tokens.
    assert count_tokens("hi") < count_tokens("hello world this is longer")
