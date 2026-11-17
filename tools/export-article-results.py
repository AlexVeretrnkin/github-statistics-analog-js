"""Export the November 2026 article's linked tables and plots from its TeX source.

Usage: python3 tools/export-article-results.py PATH_TO_JCAM_SOURCE
Requires Poppler (pdftocairo). Only explicitly linked results are published.
"""
import csv
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "public/research/article-experiment/2026-11"
CATALOG = ROOT / "src/app/core/article-results-2026-11.json"
LINK = re.compile(r"\\resultlink\{([\w-]+)\}\{Online (table|figure)\}")
CAPTION = re.compile(r"\\caption(?:of\{table\})?\{(.*?)\s+\\resultlink")
INDEX = Path("supplement-data/index")


def plain(tex):
    for old, new in [(r"\widehat\sigma^2", "σ̂²"), ("_{12}", "₁₂"),
                     (r"\Delta", "Δ"), (r"\log", "log"), (r"\%", "%"), (r"\ref{fig:1}", "1"),
                     ("--", "–"), ("~", " "), ("$", "")]:
        tex = tex.replace(old, new)
    if "\\" in tex or "{" in tex:
        raise ValueError(f"Untranslated table or caption markup: {tex}")
    return tex.strip()


def table_cells(source, slug):
    body = source.split(r"\toprule", 1)[1].split(r"\bottomrule", 1)[0]
    headings, values = body.split(r"\midrule")
    # Flatten the two multi-level headers for screen readers and small screens.
    header = headings.strip().rstrip("\\").split(r"\\")[-1]
    columns = [plain(cell) for cell in header.split("&")]
    if slug == "index-route-comparison":
        columns = ["Framework", "h", "Selected fit", "Δ WAPE", "SARIMA C−D",
                   "ETS C−D", "Prophet C−D", "Hits: fit", "Hits: N", "Hits: L"]
    if slug == "index-direction-accuracy":
        columns = ["Framework", "h", "SARIMA D", "SARIMA C", "ETS D", "ETS C",
                   "Prophet D", "Prophet C", "Naive", "Seasonal naive"]
    if slug.startswith("index-") and slug.endswith("-point-errors"):
        columns = ["h", "Model", "D: MAE", "D: RMSE", "D: WAPE",
                   "C: MAE", "C: RMSE", "C: WAPE"]
    rows = [[plain(cell) for cell in line.split("&")]
            for line in values.split(r"\\") if line.strip()]
    if not rows or any(len(row) != len(columns) for row in rows):
        raise ValueError(f"Unexpected dimensions in {slug}")
    return columns, rows


def table_note(file, slug):
    if file == "supplement-numerical-tables.tex":
        if slug == "origin-frequencies":
            return "24 origins per series and horizon. Tied absolute errors divide one count equally."
        unit = "millions of downloads" if slug.startswith("npm-") else "monthly star increments"
        measure = ("Coverage is a percentage; IS is the interval score." if slug.endswith("-intervals")
                   else "WAPE is a percentage. SD, P10 and P90 summarize the absolute errors.")
        return f"24 expanding-window origins at each horizon h (months). Dimensional values use {unit}. {measure}"
    if file == "supplement-index-tables.tex":
        scope = ("Equal-weight geometric index over 24 origins. D = direct index forecast; "
                 "C = forecasts of the two components combined.")
        if slug.endswith("-intervals"):
            return scope + " Each cell gives the coverage count out of 24 / mean width in index points (single-month residual bootstrap)."
        if slug.endswith("-point-errors"):
            return scope + " MAE and RMSE use index points; WAPE is a percentage."
        return scope
    return ""


def figure_data(source, slug, pdf):
    subprocess.run(["pdftocairo", "-svg", str(pdf), str(ASSETS / f"{slug}.svg")], check=True)
    if slug in ("github-stars-heldout", "npm-downloads-heldout"):
        metric = slug.removesuffix("-heldout")
        input_file = Path("figures/heldout-series.csv")
        def include(row):
            return row["metric"] == metric
    elif slug == "index-component-sarima-6-months":
        input_file = INDEX / "intervals/interval-predictions.csv"
        def include(row):
            return (row["model"], row["route"], row["block"], row["horizon"]) == ("SARIMA", "components", "1", "6")
    elif slug in ("index-weight-sensitivity", "index-weight-range"):
        input_file = INDEX / "construction/direction-stability.csv"
        def include(row):
            return slug == "index-weight-sensitivity" or row["component_disagreement"] == "TRUE"
    else:
        raise ValueError(f"Unknown article plot {slug}")
    with (source / input_file).open(newline="") as src, (ASSETS / f"{slug}.csv").open("w", newline="") as dest:
        reader = csv.DictReader(src)
        writer = csv.DictWriter(dest, fieldnames=reader.fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(row for row in reader if include(row))


def export(source):
    ASSETS.mkdir(exist_ok=True, parents=True)
    catalog = {}
    files = ["manuscript.tex", "supplement-numerical-tables.tex",
             "supplement-index-tables.tex", "supplement-residuals.tex"]
    counts = {}
    for file in files:
        content = (source / file).read_text()
        supplement = file != "manuscript.tex"
        for caption in re.finditer(r"^\\caption(?:of\{table\})?\{.*$", content, re.M):
            line = caption.group()
            table = r"\captionof{table}" in line or content.rfind(r"\begin{table}", 0, caption.start()) > content.rfind(r"\begin{figure}", 0, caption.start())
            kind = "table" if table else "figure"
            key = (supplement, kind)
            counts[key] = counts.get(key, 0) + 1
            link = LINK.search(line)
            if not link:  # Residual panels link directly to the existing interactive chart.
                if kind != "figure" or ("residual" not in line.lower()):
                    raise ValueError(f"Missing result link: {line}")
                continue
            slug = link[1]
            if slug in catalog or kind != link[2]:
                raise ValueError(f"Duplicate or mismatched result: {slug}")
            number = ("S" if supplement else "") + str(counts[key])
            entry = {"label": f"{kind.title()} {number}", "caption": plain(CAPTION.search(line)[1])}
            if table:
                block = re.split(r"\\end\{(?:table|minipage)\}", content[caption.end():], maxsplit=1)[0]
                columns, rows = table_cells(block, slug)
                note = re.search(r"^\\articletablenote\{(.*)\}$", block, re.M)
                entry.update(columns=columns, rows=rows, note=plain(note[1]) if note else table_note(file, slug))
            else:
                begin = content.rindex(r"\begin{figure}", 0, caption.start())
                graphic = re.search(r"\\includegraphics\[[^\]]+\]\{([^}]+)\}", content[begin:caption.start()])
                figure_data(source, slug, source / graphic[1])
                entry["figure"] = True
            catalog[slug] = entry
    if counts != {(False, "figure"): 5, (False, "table"): 9, (True, "figure"): 7, (True, "table"): 20}:
        raise ValueError(f"Unexpected November 2026 article inventory: {counts}")
    CATALOG.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    export(Path(sys.argv[1]))
