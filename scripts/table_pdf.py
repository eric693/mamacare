# -*- coding: utf-8 -*-
# 讀 stdin 的 {title, columns:[{key,label}], rows:[{...}]} JSON，輸出表格 PDF 到 stdout。
import sys, json
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT

FONT = "WQY"
pdfmetrics.registerFont(TTFont(FONT, "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", subfontIndex=0))

d = json.load(sys.stdin)
cols = d.get("columns", [])
rows = d.get("rows", [])
title = d.get("title", "資料匯出")

H = ParagraphStyle("h", fontName=FONT, fontSize=15, leading=20, textColor=colors.HexColor("#1f5f5a"), spaceAfter=2)
SUB = ParagraphStyle("s", fontName=FONT, fontSize=9, leading=12, textColor=colors.HexColor("#6b7c79"), spaceAfter=8)
CELL = ParagraphStyle("c", fontName=FONT, fontSize=7.5, leading=10)
CELLH = ParagraphStyle("ch", fontName=FONT, fontSize=7.5, leading=10, textColor=colors.white)

def esc(v):
    return str("" if v is None else v).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

flow = [Paragraph(esc(title), H), Paragraph("共 %d 筆　匯出時間 %s" % (len(rows), d.get("date", "")), SUB)]

if cols and rows:
    header = [Paragraph(esc(c.get("label", c.get("key"))), CELLH) for c in cols]
    data = [header]
    for r in rows:
        data.append([Paragraph(esc(r.get(c["key"], "")), CELL) for c in cols])
    page_w = landscape(A4)[0] - 24 * mm
    cw = page_w / len(cols)
    t = Table(data, repeatRows=1, colWidths=[cw] * len(cols))
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f5f5a")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f4f6f5")]),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#dde5e3")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    flow.append(t)
else:
    flow.append(Paragraph("（無資料）", CELL))

SimpleDocTemplate(sys.stdout.buffer, pagesize=landscape(A4),
                  topMargin=12 * mm, bottomMargin=10 * mm, leftMargin=12 * mm, rightMargin=12 * mm,
                  title=title).build(flow)
