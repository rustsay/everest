"""PDF report generation using fpdf2 (pure Python, no system lib deps)."""
from __future__ import annotations

import logging
from datetime import datetime

from fpdf import FPDF

from app.agents.prompts.tasks import TASK_CONFIGS

log = logging.getLogger(__name__)

CONSENSUS_LABEL = {
    "full": "Полный консенсус (3/3)",
    "majority": "Большинство (2/3)",
    "judge_decision": "Решение судьи",
}

_FONT_REGULAR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
_FONT_BOLD    = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# Colours (R, G, B)
_BLUE   = (37, 99, 235)
_GREEN  = (22, 163, 74)
_YELLOW = (217, 119, 6)
_RED    = (220, 38, 38)
_GRAY   = (107, 114, 128)
_LIGHT  = (249, 250, 251)
_BORDER = (229, 231, 235)
_BLACK  = (26, 26, 26)


def _score_color(score: int, max_score: int) -> tuple:
    pct = score / max_score if max_score else 0
    return _GREEN if pct == 1 else _YELLOW if pct >= 0.5 else _RED


class _PDF(FPDF):
    def header(self):
        pass  # custom header drawn in build_pdf

    def footer(self):
        self.set_y(-12)
        self.set_font("regular", size=8)
        self.set_text_color(*_GRAY)
        self.cell(0, 5, f"Страница {self.page_no()}", align="C")


def build_pdf(session_id: str, task_rows: list, created_at: datetime, total: int, done_count: int) -> bytes:
    task_ids = sorted(TASK_CONFIGS.keys())
    max_total = sum(c["max_score"] for c in TASK_CONFIGS.values())
    pct = round(total / max_total * 100) if max_total else 0
    date_str = created_at.strftime("%d.%m.%Y %H:%M") if created_at else datetime.now().strftime("%d.%m.%Y %H:%M")
    gen_str = datetime.now().strftime("%d.%m.%Y %H:%M")

    pdf = _PDF(format="A4")
    pdf.add_font("regular", fname=_FONT_REGULAR)
    pdf.add_font("bold",    fname=_FONT_BOLD)
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.set_margins(20, 20, 20)
    pdf.add_page()

    W = pdf.epw  # effective page width

    # ── Title ──────────────────────────────────────────────────────────
    pdf.set_font("bold", size=18)
    pdf.set_text_color(*_BLACK)
    pdf.cell(0, 9, "Отчёт о проверке ЕГЭ", new_x="LEFT", new_y="NEXT")

    pdf.set_font("regular", size=9)
    pdf.set_text_color(*_GRAY)
    pdf.cell(0, 6, f"Сессия: {session_id}   ·   Создана: {date_str}   ·   Отчёт: {gen_str}", new_x="LEFT", new_y="NEXT")
    pdf.ln(3)

    # ── Summary box ────────────────────────────────────────────────────
    box_h = 20
    pdf.set_fill_color(240, 244, 255)
    pdf.set_draw_color(*_BORDER)
    pdf.rect(20, pdf.get_y(), W, box_h, style="FD")

    y0 = pdf.get_y() + 4
    col_w = W / 3
    items = [
        (f"{total} / {max_total}", "Итоговый балл"),
        (f"{pct}%",               "От максимума"),
        (f"{done_count} / {len(task_ids)}", "Проверено заданий"),
    ]
    for i, (val, lbl) in enumerate(items):
        x = 20 + i * col_w
        pdf.set_xy(x + 4, y0)
        pdf.set_font("bold", size=14)
        pdf.set_text_color(*_BLUE)
        pdf.cell(col_w - 8, 7, val)
        pdf.set_xy(x + 4, y0 + 7)
        pdf.set_font("regular", size=8)
        pdf.set_text_color(*_GRAY)
        pdf.cell(col_w - 8, 5, lbl)

    pdf.set_y(pdf.get_y() + box_h + 4)

    # ── Task sections ──────────────────────────────────────────────────
    for tid in task_ids:
        row = next((r for r in task_rows if r.task_id == tid), None)
        cfg = TASK_CONFIGS[tid]
        topic = cfg["topic"]
        max_s = cfg["max_score"]

        pdf.ln(2)
        # Task header bar
        bar_y = pdf.get_y()
        pdf.set_fill_color(243, 244, 246)
        pdf.set_draw_color(*_BORDER)
        pdf.rect(20, bar_y, W, 10, style="FD")

        pdf.set_xy(22, bar_y + 1.5)
        pdf.set_font("bold", size=9)
        pdf.set_text_color(*_GRAY)
        pdf.cell(30, 7, f"ЗАДАНИЕ {tid}")

        pdf.set_font("bold", size=10)
        pdf.set_text_color(*_BLACK)
        pdf.cell(W - 70, 7, topic)

        if row and row.status == "done" and row.judge_decision:
            j = row.judge_decision
            final = j.get("final_score", 0)
            color = _score_color(final, max_s)
            pdf.set_font("bold", size=11)
            pdf.set_text_color(*color)
            pdf.cell(30, 7, f"{final} / {max_s}", align="R")
        else:
            pdf.set_font("regular", size=9)
            pdf.set_text_color(*_GRAY)
            pdf.cell(30, 7, "не проверено", align="R")

        pdf.set_y(bar_y + 12)

        if not row or row.status != "done" or not row.judge_decision:
            continue

        j = row.judge_decision
        consensus = CONSENSUS_LABEL.get(j.get("consensus_level", ""), "")
        reasoning = j.get("reasoning", "")

        # Judge verdict
        pdf.set_font("bold", size=8)
        pdf.set_text_color(*_GRAY)
        pdf.cell(0, 5, f"ВЕРДИКТ СУДЬИ   [{consensus}]", new_x="LEFT", new_y="NEXT")
        pdf.set_font("regular", size=9)
        pdf.set_text_color(*_BLACK)
        pdf.set_x(20)
        pdf.multi_cell(W, 5, reasoning, new_x="LEFT", new_y="NEXT")
        pdf.ln(1)

        # Agent table
        if row.agent_verdicts:
            pdf.set_font("bold", size=8)
            pdf.set_text_color(*_GRAY)
            pdf.cell(0, 5, "ОЦЕНКИ ЭКСПЕРТОВ", new_x="LEFT", new_y="NEXT")

            col_widths = [22, 16, W - 22 - 16 - 40, 40]
            headers = ["Эксперт", "Балл", "Обоснование", "Ошибки"]
            pdf.set_fill_color(243, 244, 246)
            pdf.set_font("bold", size=8)
            pdf.set_text_color(*_BLACK)
            for w, h in zip(col_widths, headers):
                pdf.cell(w, 6, h, border="B", fill=True)
            pdf.ln()

            pdf.set_font("regular", size=8)
            for v in row.agent_verdicts:
                sc = v.get("score", 0)
                ms = v.get("max_score", max_s)
                reason = v.get("reasoning", "")[:120]
                errors = "; ".join(v.get("errors_found", [])) or "—"
                errors = errors[:60]
                color = _score_color(sc, ms)

                row_y = pdf.get_y()
                # Calculate row height from tallest cell
                lines_r = pdf.get_string_width(reason) / (col_widths[2] - 2) + 1
                row_h = max(6, int(lines_r + 1) * 5)

                pdf.set_text_color(*_GRAY)
                pdf.cell(col_widths[0], row_h, f"Эксперт {v.get('agent_id','?')}", border="B")
                pdf.set_text_color(*color)
                pdf.set_font("bold", size=8)
                pdf.cell(col_widths[1], row_h, f"{sc}/{ms}", border="B")
                pdf.set_font("regular", size=8)
                pdf.set_text_color(*_BLACK)

                x_after_score = pdf.get_x()
                pdf.multi_cell(col_widths[2], 5, reason, border=0, new_x="LEFT", new_y="NEXT")
                new_y = pdf.get_y()

                pdf.set_xy(x_after_score + col_widths[2], row_y)
                pdf.set_text_color(*_GRAY)
                pdf.multi_cell(col_widths[3], 5, errors, border=0, new_x="LEFT", new_y="NEXT")

                pdf.set_y(max(new_y, pdf.get_y()))
                pdf.set_draw_color(*_BORDER)
                pdf.line(20, pdf.get_y(), 20 + W, pdf.get_y())

            pdf.ln(2)


    log.info("fpdf2: generated PDF session=%s pages=%d", session_id[:8], pdf.page)
    return bytes(pdf.output())
