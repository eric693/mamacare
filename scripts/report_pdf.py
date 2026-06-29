# -*- coding: utf-8 -*-
# 讀 stdin 的月報 JSON，輸出 PDF 到 stdout（評鑑佐證一鍵下載）
import sys, json
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER

FONT = "WQY"
pdfmetrics.registerFont(TTFont(FONT, "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", subfontIndex=0))

def mk(size, leading, color=colors.black, align=TA_LEFT, after=6, bold=False):
    return ParagraphStyle("s", fontName=FONT, fontSize=size, leading=leading,
                          textColor=color, alignment=align, spaceAfter=after)

H1 = mk(18, 24, colors.HexColor("#1f5f5a"), TA_CENTER, 4)
SUB = mk(10.5, 15, colors.HexColor("#6b7c79"), TA_CENTER, 10)
H2 = mk(13, 18, colors.HexColor("#1f5f5a"), after=4)
BODY = mk(10, 15)
CELL = mk(9, 12.5)
CELLH = mk(9, 12.5, colors.white)
CELLBAD = mk(9, 12.5, colors.HexColor("#c0392b"))

def P(t, s): return Paragraph(str(t), s)

d = json.load(sys.stdin)
flow = []
flow.append(P(f"{d.get('center_name','')} 產後護理機構月報", H1))
flow.append(P(f"報表月份：{d.get('month','')}　（衛福部評鑑佐證）", SUB))

# 重點指標
rev = d.get("revenue", {}) or {}
metrics = [
    ["住房率", f"{d.get('occupancy_rate',0)}%", "寶寶照護紀錄", d.get("total_baby_records",0)],
    ["媽媽照護紀錄", d.get("total_mother_records",0), "交班紀錄", d.get("total_handovers",0)],
    ["紅臀發生率", f"{d.get('rash_rate',0)}%", "異常事件(未結)", f"{d.get('incident_total',0)}({d.get('incident_open',0)})"],
    ["手部衛生遵從率", ("-" if d.get('hand_hygiene',{}).get('rate') is None else f"{d['hand_hygiene']['rate']}%"), "待追蹤篩檢", d.get("screening_pending",0)],
    ["當月實收款", f"NT${rev.get('payments_received',0):,}", "加購入帳", f"NT${rev.get('addon_billed',0):,}"],
]
mt = Table([[P(a,CELL),P(b,CELL),P(c,CELL),P(e,CELL)] for a,b,c,e in metrics], colWidths=[40*mm,45*mm,40*mm,45*mm])
mt.setStyle(TableStyle([
    ("GRID",(0,0),(-1,-1),0.5,colors.HexColor("#dde5e3")),
    ("BACKGROUND",(0,0),(0,-1),colors.HexColor("#e3f2f0")),
    ("BACKGROUND",(2,0),(2,-1),colors.HexColor("#e3f2f0")),
    ("VALIGN",(0,0),(-1,-1),"MIDDLE"),("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
]))
flow += [P("一、重點指標", H2), mt, Spacer(1,10)]

# 人力比合規
nc = d.get("non_compliant_days", [])
flow.append(P("二、法定人力比合規", H2))
if nc:
    flow.append(P(f"不合規 {len(nc)} 天：{'、'.join(nc)}", CELLBAD))
else:
    flow.append(P("全月各班別皆符合法定人力比。", BODY))
flow.append(Spacer(1,8))

# 逐日明細
flow.append(P("三、逐日明細", H2))
head = ["日期","住房","嬰兒","寶寶紀錄","媽媽紀錄","交班","白班","小夜","大夜","合規"]
data = [[P(h,CELLH) for h in head]]
for day in d.get("days", []):
    st = day.get("staffing", [])
    def sh(i):
        return f"{st[i]['nurses']}/{st[i]['required']}" if i < len(st) else "-"
    ok = "無住客" if day.get("babies",0)==0 else ("符合" if day.get("staffing_ok") else "不足")
    style = CELL if ok != "不足" else CELLBAD
    row = [day["date"][5:], f"{day.get('occupied_rooms',0)}/{d.get('total_rooms',0)}", day.get("babies",0),
           day.get("baby_records",0), day.get("mother_records",0), day.get("handovers",0),
           sh(0), sh(1), sh(2), ok]
    data.append([P(c, style) for c in row])
dt = Table(data, repeatRows=1, colWidths=[15*mm,16*mm,13*mm,18*mm,18*mm,13*mm,15*mm,15*mm,15*mm,16*mm])
dt.setStyle(TableStyle([
    ("BACKGROUND",(0,0),(-1,0),colors.HexColor("#1f5f5a")),
    ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white, colors.HexColor("#f4f6f5")]),
    ("GRID",(0,0),(-1,-1),0.4,colors.HexColor("#dde5e3")),
    ("VALIGN",(0,0),(-1,-1),"MIDDLE"),("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3),
]))
flow.append(dt)

doc = SimpleDocTemplate(sys.stdout.buffer, pagesize=A4,
                        topMargin=16*mm, bottomMargin=14*mm, leftMargin=14*mm, rightMargin=14*mm,
                        title=f"月報 {d.get('month','')}")
doc.build(flow)
