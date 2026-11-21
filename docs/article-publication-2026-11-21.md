# Article revision — 21 November 2026

Public files: `/research/article/2026-11-21/` (linked from Research Validation).

- `manuscript.pdf`: 20 pages; revised stochastic-index Section 3.6 and related sections, Naive/SNaive in the abstract, and rationale for the fixed September 2022–August 2023 reference period.
- `supplement-residuals.pdf`: 24 pages; existing tables/figures plus proofs with references to the main manuscript.
- `article-source.zip`: complete editable LaTeX package, figures, saved numerical tables and revision notes. Build the manuscript with XeLaTeX before the supplement with pdfLaTeX; see README_UK.md in the archive.
- `SHA256SUMS`: checksums of both PDFs and the source archive.

The mathematical changes are reviewable in `article-stochastic-index.patch` relative to the 10 November source package. Numerical results are unchanged. DSP is a proposed extension, not a newly computed empirical result. Selection of the reference period is explicitly retrospective.

Validation: both PDFs compiled; all 41 application links (40 unique states) pass `tools/verify-article-pdf-links.py`. The same states were checked in the public application, including all three residual models and automatic table expansion. Public PDF bytes must match SHA256SUMS after deployment.

Only article publication assets and the Research Validation download links belong to this release; unrelated spike/event work is excluded.
