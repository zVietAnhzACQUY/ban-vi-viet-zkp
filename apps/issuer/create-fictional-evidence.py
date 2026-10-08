"""Creates a synthetic classroom fixture, never an identity document."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
out = Path(__file__).resolve().parents[2] / '.work' / 'fixtures' / 'fictional-record.png'
out.parent.mkdir(parents=True, exist_ok=True)
image = Image.new('RGB', (900, 520), '#F4F7FB')
draw = ImageDraw.Draw(image)
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 30)
draw.rectangle((30, 30, 870, 490), outline='#2563EB', width=4)
lines = ['FICTIONAL CLASSROOM RECORD', 'NOT AN IDENTITY DOCUMENT', 'No real person. No identity number.', 'No date of birth or personal information.', 'For upload and access-control testing only.']
for i, line in enumerate(lines):
    draw.text((65, 70+i*70), line, font=font, fill='#172033')
image.save(out)
print('Synthetic PNG fixture created.')
