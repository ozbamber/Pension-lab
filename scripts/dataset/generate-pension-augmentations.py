#!/usr/bin/env python3
"""Generate deterministic, local-only Pension Report V2 robustness children."""

from __future__ import annotations

import hashlib
import io
import json
import os
import random
import shutil
import subprocess
import tempfile
from collections import Counter
from pathlib import Path

from PIL import Image, ImageFilter
from pypdf import PdfReader, PdfWriter


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "dataset" / "metadata" / "manifest.jsonl"
SUMMARY = ROOT / "dataset" / "metadata" / "summary.json"
SPLITS = ROOT / "dataset" / "splits"
OUTPUT = ROOT / "dataset" / "documents" / "pension_report" / "augmented-v2"
GROUND_TRUTH = ROOT / "dataset" / "ground-truth"
OBSERVATIONS = ROOT / "dataset" / "observations" / "pdf-text"
ORIGIN_DETAIL = "pension-report-v2-augmentation"

SPECS = [
    {
        "slug": "150dpi-gray-jpeg-rotate-noise",
        "parent": "pld2-eefc78619c56a5a5",
        "dpi": 150,
        "grayscale": True,
        "jpeg_quality": 68,
        "blur": 0.35,
        "rotation_deg": 1.5,
        "noise": 3,
        "mixed": False,
    },
    {
        "slug": "200dpi-gray-jpeg-negative-rotate",
        "parent": "pld2-d14b70c6573e56c7",
        "dpi": 200,
        "grayscale": True,
        "jpeg_quality": 76,
        "blur": 0.0,
        "rotation_deg": -1.5,
        "noise": 2,
        "mixed": False,
    },
    {
        "slug": "300dpi-jpeg-light-blur",
        "parent": "pld2-41155a43d67aedcf",
        "dpi": 300,
        "grayscale": False,
        "jpeg_quality": 88,
        "blur": 0.25,
        "rotation_deg": 0.0,
        "noise": 0,
        "mixed": False,
    },
    {
        "slug": "mixed-text-ocr-200dpi",
        "parent": "pld2-bd5ea5fd46ce545e",
        "dpi": 200,
        "grayscale": True,
        "jpeg_quality": 78,
        "blur": 0.2,
        "rotation_deg": 0.7,
        "noise": 2,
        "mixed": True,
    },
]


def find_pdftoppm() -> str:
    configured = os.environ.get("PDFTOPPM_PATH")
    if configured and Path(configured).is_file():
        return configured
    discovered = shutil.which("pdftoppm")
    if discovered:
        return discovered
    raise RuntimeError("pdftoppm was not found; set PDFTOPPM_PATH to the local Poppler binary")


def load_manifest() -> list[dict]:
    return [json.loads(line) for line in MANIFEST.read_text(encoding="utf-8").splitlines() if line.strip()]


def add_noise(image: Image.Image, strength: int, seed: str) -> Image.Image:
    if strength <= 0:
        return image
    rng = random.Random(seed)
    pixels = image.load()
    for _ in range(max(1, image.width * image.height // 180)):
        x = rng.randrange(image.width)
        y = rng.randrange(image.height)
        value = rng.randint(-strength, strength)
        current = pixels[x, y]
        if isinstance(current, tuple):
            pixels[x, y] = tuple(max(0, min(255, channel + value)) for channel in current[:3])
        else:
            pixels[x, y] = max(0, min(255, current + value))
    return image


def transform(image: Image.Image, spec: dict) -> Image.Image:
    result = image.convert("L" if spec["grayscale"] else "RGB")
    if spec["blur"]:
        result = result.filter(ImageFilter.GaussianBlur(spec["blur"]))
    if spec["rotation_deg"]:
        result = result.rotate(spec["rotation_deg"], resample=Image.Resampling.BICUBIC, expand=False, fillcolor=255 if result.mode == "L" else (255, 255, 255))
    result = add_noise(result, spec["noise"], spec["slug"])
    compressed = io.BytesIO()
    result.save(compressed, "JPEG", quality=spec["jpeg_quality"], optimize=True, dpi=(spec["dpi"], spec["dpi"]))
    compressed.seek(0)
    with Image.open(compressed) as reopened:
        return reopened.convert("RGB")


def raster_pdf(source: Path, destination: Path, spec: dict, pdftoppm: str) -> None:
    with tempfile.TemporaryDirectory(prefix="pension-lab-augmentation-") as temp_name:
        prefix = Path(temp_name) / "page"
        subprocess.run([pdftoppm, "-png", "-r", str(spec["dpi"]), str(source), str(prefix)], check=True, stdout=subprocess.DEVNULL)
        pages = [transform(Image.open(path), spec) for path in sorted(Path(temp_name).glob("page-*.png"))]
        if not pages:
            raise RuntimeError(f"No pages rendered for {source}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        pages[0].save(destination, "PDF", resolution=spec["dpi"], save_all=True, append_images=pages[1:])


def mixed_pdf(source: Path, rasterized: Path, destination: Path) -> None:
    source_reader = PdfReader(str(source))
    raster_reader = PdfReader(str(rasterized))
    writer = PdfWriter()
    for index, page in enumerate(source_reader.pages):
        writer.add_page(page if index == 0 else raster_reader.pages[index])
    with destination.open("wb") as handle:
        writer.write(handle)


def update_summary(records: list[dict]) -> None:
    def counter(key):
        return dict(Counter(record[key] for record in records))

    families = dict(Counter(record["family"] for record in records))
    payload = {
        "documents": len(records),
        "by_type": counter("document_type"),
        "by_source_type": counter("source_type"),
        "by_quality": counter("quality"),
        "by_split": counter("split"),
        "families": families,
        "text_layer": {
            "yes": sum(1 for record in records if record["has_text_layer"]),
            "no": sum(1 for record in records if not record["has_text_layer"]),
        },
    }
    SUMMARY.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    pdftoppm = find_pdftoppm()
    previous_records = load_manifest()
    previous_generated_ids = {record["id"] for record in previous_records if record.get("origin_detail") == ORIGIN_DETAIL}
    for document_id in previous_generated_ids:
        truth_path = GROUND_TRUTH / f"{document_id}.json"
        if truth_path.exists():
            truth_path.unlink()
        observation_path = OBSERVATIONS / f"{document_id}.txt"
        if observation_path.exists():
            observation_path.unlink()
    records = [record for record in previous_records if record.get("origin_detail") != ORIGIN_DETAIL]
    by_id = {record["id"]: record for record in records}
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for stale in OUTPUT.glob("*.pdf"):
        stale.unlink()

    generated = []
    for spec in SPECS:
        parent = by_id[spec["parent"]]
        source = ROOT / parent["path"]
        output = OUTPUT / f"{spec['slug']}.pdf"
        if spec["mixed"]:
            with tempfile.TemporaryDirectory(prefix="pension-lab-mixed-") as temp_name:
                rasterized = Path(temp_name) / "raster.pdf"
                raster_pdf(source, rasterized, spec, pdftoppm)
                mixed_pdf(source, rasterized, output)
        else:
            raster_pdf(source, output, spec, pdftoppm)
        digest = hashlib.sha256(output.read_bytes()).hexdigest()
        document_id = f"pld2-{digest[:16]}"
        mixed_text = ""
        if spec["mixed"]:
            mixed_text = "\n".join((page.extract_text() or "") for page in PdfReader(str(output)).pages).strip()
            (OBSERVATIONS / f"{document_id}.txt").write_text(mixed_text + "\n", encoding="utf-8")
        truth = json.loads((GROUND_TRUTH / f"{parent['id']}.json").read_text(encoding="utf-8"))
        truth["id"] = document_id
        truth["annotation"]["evidence"]["contributionHistory"] = {
            "method": "direct_augmented_pdf_and_parent_lineage_inspection",
            "parentDocument": parent["id"],
            "sourcePages": sorted({row["sourcePage"] for row in truth["contribution_history"]}),
            "monthlyRowsReviewed": len(truth["contribution_history"]),
            "excludedRowsReviewed": len(truth["contributionTableGroundTruth"]["excludedRows"]),
            "productionParserUsed": False,
        }
        (GROUND_TRUTH / f"{document_id}.json").write_text(json.dumps(truth, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        generated.append({
            "id": document_id,
            "document_type": "pension_report",
            "path": output.relative_to(ROOT).as_posix(),
            "sha256": digest,
            "source_type": "augmented",
            "origin_detail": ORIGIN_DETAIL,
            "family": parent["family"],
            "template_family": parent["template_family"],
            "quality": "degraded",
            "digital_or_scan": "digital" if spec["mixed"] else "scan",
            "has_text_layer": bool(spec["mixed"]),
            "pages": parent["pages"],
            "text_chars": len(mixed_text) if spec["mixed"] else 0,
            "language": parent["language"],
            "source_url": None,
            "source_name": None,
            "retrieval_date": None,
            "license_or_consent": "generated_from_synthetic_parent",
            "parent_document": parent["id"],
            "degradation": {
                "dpi": spec["dpi"],
                "grayscale": spec["grayscale"],
                "jpeg_quality": spec["jpeg_quality"],
                "blur": bool(spec["blur"]),
                "blur_radius": spec["blur"],
                "rotation_deg": spec["rotation_deg"],
                "noise": bool(spec["noise"]),
                "noise_strength": spec["noise"],
                "cropped": False,
                "text_layer_removed": not spec["mixed"],
                "mixed_text_ocr_pages": bool(spec["mixed"]),
            },
            "layout_reference": None,
            "annotation_version": 2,
            "split": parent["split"],
        })

    current_ids = {record["id"] for record in records}
    for truth_file in GROUND_TRUTH.glob("pld2-*.json"):
        if truth_file.stem not in current_ids and truth_file.stem not in {record["id"] for record in generated}:
            continue
    records.extend(generated)
    records.sort(key=lambda record: record["id"])
    MANIFEST.write_text("".join(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n" for record in records), encoding="utf-8")
    generated_by_split = {}
    for record in generated:
        generated_by_split.setdefault(record["split"], []).append(record["id"])
    for split_path in SPLITS.glob("*.json"):
        split = json.loads(split_path.read_text(encoding="utf-8"))
        existing = [document_id for document_id in split.get("document_ids", []) if document_id in {record["id"] for record in records}]
        split["document_ids"] = sorted(set(existing + generated_by_split.get(split["name"], [])))
        split_path.write_text(json.dumps(split, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    update_summary(records)
    print(f"Generated {len(generated)} Pension Report V2 augmentation children.")
    for record in generated:
        print(f"{record['id']} {record['path']} parent={record['parent_document']} split={record['split']}")


if __name__ == "__main__":
    main()
