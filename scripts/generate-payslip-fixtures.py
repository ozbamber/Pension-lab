from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIR = ROOT / "tests" / "fixtures" / "payslips"
FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

ROWS = [
    ("Pensionable salary", "23,500"),
    ("Employee contribution", "1,645    7%"),
    ("Employer contribution", "1,527.50    6.5%"),
    ("Severance", "1,957.55    8.33%"),
    ("Payslip month", "08/2026"),
]


def font(size: int):
    candidates = [
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/segoeui.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def create_native_pdf(path: Path):
    pdf = canvas.Canvas(str(path), pagesize=A4, pageCompression=1)
    width, height = A4
    pdf.setTitle("Synthetic Pension Lab payslip - native text")
    pdf.setFont("Helvetica-Bold", 18)
    pdf.drawString(54, height - 64, "Synthetic payslip - no personal data")
    pdf.setFont("Helvetica", 12)
    y = height - 120
    for label, value in ROWS:
        pdf.drawString(60, y, label)
        pdf.drawRightString(width - 60, y, value)
        y -= 42
    pdf.showPage()
    pdf.save()


def create_scanned_pdf(path: Path):
    image = Image.new("RGB", (1800, 1200), "white")
    draw = ImageDraw.Draw(image)
    title_font = font(54)
    body_font = font(42)
    value_font = font(46)
    draw.text((100, 80), "SYNTHETIC PAYSLIP - NO PERSONAL DATA", fill="black", font=title_font)
    draw.line((100, 170, 1700, 170), fill="#222222", width=4)
    y = 240
    for label, value in ROWS:
        draw.text((120, y), label, fill="black", font=body_font)
        draw.text((1680, y), value, fill="black", font=value_font, anchor="ra")
        draw.line((110, y + 68, 1690, y + 68), fill="#bbbbbb", width=2)
        y += 150

    pdf = canvas.Canvas(str(path), pagesize=A4, pageCompression=1)
    width, height = A4
    pdf.setTitle("Synthetic Pension Lab payslip - scanned image")
    pdf.drawImage(ImageReader(image), 24, 24, width=width - 48, height=height - 48, preserveAspectRatio=True, anchor="c")
    pdf.showPage()
    pdf.save()


if __name__ == "__main__":
    create_native_pdf(FIXTURE_DIR / "synthetic-native-text-payslip.pdf")
    create_scanned_pdf(FIXTURE_DIR / "synthetic-scanned-payslip.pdf")
    print(f"Generated 2 synthetic PDF fixtures in {FIXTURE_DIR}")
