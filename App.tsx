import streamlit as st
import gspread
from google.oauth2.service_account import Credentials
import json
import os
import pandas as pd
from datetime import datetime
import io

# PDF/Excel Libraries
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, Border, Side, PatternFill
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from streamlit_calendar import calendar

# ================= CONFIGURATION =================
st.set_page_config(page_title="Interview Scheduler", layout="wide", page_icon="📅")

# --- Load secrets from environment variables ---
creds_json = os.getenv("GOOGLE_APPLICATION_CREDENTIALS_JSON")
sheet_id = os.getenv("GOOGLE_SHEET_ID")

if not creds_json:
    st.error("❌ Missing GOOGLE_APPLICATION_CREDENTIALS_JSON environment variable.")
    st.stop()
if not sheet_id:
    st.error("❌ Missing GOOGLE_SHEET_ID environment variable.")
    st.stop()

# --- Connect to Google Sheets ---
try:
    creds_dict = json.loads(creds_json)
    SCOPES = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive"
    ]
    creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
    client = gspread.authorize(creds)
    sheet = client.open_by_key(sheet_id).sheet1
except Exception as e:
    st.error(f"❌ Google Sheets connection failed: {type(e).__name__}: {str(e)}")
    st.stop()

# ================= TIME SLOT GENERATOR =================
TIME_SLOTS = []
for h in range(11, 22):
    for m in (0, 30):
        if h == 21 and m == 30: continue
        TIME_SLOTS.append(f"{h:02d}:{m:02d}")

# ================= DATA FUNCTIONS =================

def clean_dataframe(df):
    """清理資料格式，確保 Google Sheet 讀寫正常"""
    df = df.astype(str)
    for col in df.columns:
        df[col] = df[col].replace(['NaT', 'nan', 'None', '<NA>'], '')
    df['Date'] = pd.to_datetime(df['Date'], errors='coerce').dt.strftime('%Y-%m-%d')
    df['Time'] = pd.to_datetime(df['Time'], format='%H:%M:00', errors='coerce').fillna(
        pd.to_datetime(df['Time'], format='%H:%M', errors='coerce')
    ).dt.strftime('%H:%M')
    return df.fillna("")

def load_data_from_google():
    """從雲端下載最新資料"""
    try:
        records = sheet.get_all_records()
        if not records:
            return pd.DataFrame(columns=["Name", "ID", "Date", "Time", "Notes"])
        df = pd.DataFrame(records)
        return clean_dataframe(df)
    except Exception as e:
        if "429" in str(e):
            st.error("⚠️ 系統繁忙 (Google API 限流)。請等待 1 分鐘後再試。")
        else:
            st.error(f"資料庫讀取錯誤: {e}")
        return pd.DataFrame(columns=["Name", "ID", "Date", "Time", "Notes"])

def initialize_session():
    """初始化"""
    if 'data' not in st.session_state:
        with st.spinner("🔄 正在連線至雲端資料庫..."):
            st.session_state.data = load_data_from_google()
        st.rerun()
    
    if 'form_id' not in st.session_state:
        st.session_state.form_id = 0
    
    if 'data_revision' not in st.session_state:
        st.session_state.data_revision = 0

def refresh_data():
    """手動重新整理"""
    st.session_state.data = load_data_from_google()
    st.session_state.data_revision += 1
    st.toast("資料已同步更新！", icon="🔄")

# ========== 【核心安全機制】 ==========

def safe_add_record(new_row_df):
    """安全新增模式"""
    try:
        with st.spinner("🔒 安全寫入中 (正在同步雲端最新資料)..."):
            # 1. 下載最新
            latest_df = load_data_from_google()
            
            # 2. 合併
            updated_df = pd.concat([latest_df, new_row_df], ignore_index=True)
            updated_df = clean_dataframe(updated_df)
            
            # 3. 上傳
            values = [updated_df.columns.tolist()] + updated_df.values.tolist()
            sheet.clear()
            sheet.update(values)
            
            # 4. 更新本地狀態
            st.session_state.data = updated_df
            st.session_state.data_revision += 1
            
            st.toast("✅ 新增成功！資料已安全同步。", icon="☁️")
            return True
    except Exception as e:
        st.error(f"寫入失敗: {e}")
        return False

def force_overwrite_data(df):
    """強制覆蓋模式"""
    try:
        clean_df = clean_dataframe(df)
        values = [clean_df.columns.tolist()] + clean_df.values.tolist()
        sheet.clear()
        sheet.update(values)
        st.session_state.data = clean_df
        st.session_state.data_revision += 1
        st.toast("變更已儲存！", icon="✅")
    except Exception as e:
        st.error(f"儲存失敗: {e}")

# ================= CONFIRMATION DIALOG =================
@st.dialog("⚠️ 確認變更")
def confirm_save_dialog(new_df):
    st.warning("您即將覆蓋雲端資料庫。")
    st.caption("注意：這會覆蓋 Google Sheet 上的內容。如果您很久沒重新整理，請先取消並按一下「同步」按鈕。")
    
    old_count = len(st.session_state.data)
    new_count = len(new_df)
    diff = old_count - new_count

    if diff > 0:
        st.error(f"🗑️ 警告：您將刪除 {diff} 筆資料！")
        st.markdown("**確定要刪除嗎？**")
    elif diff < 0:
        st.success(f"➕ 您將新增 {new_count - old_count} 筆資料。")
    else:
        st.info("📝 您正在修改現有資料。")

    col1, col2 = st.columns(2)
    
    if col1.button("✅ 是，確認覆蓋"):
        force_overwrite_data(new_df)
        st.rerun()
        
    if col2.button("❌ 不，取消"):
        st.rerun()

# ================= EXPORT FUNCTIONS =================

def generate_visual_pdf(df):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), topMargin=30, bottomMargin=30)
    elements = []
    
    font_name = "Helvetica"
    try:
        if os.path.exists("NotoSansCJKtc-Regular.ttf"):
            pdfmetrics.registerFont(TTFont('CustomChinese', 'NotoSansCJKtc-Regular.ttf'))
            font_name = 'CustomChinese'
        elif os.path.exists("font.ttf"):
            pdfmetrics.registerFont(TTFont('CustomChinese', 'font.ttf'))
            font_name = 'CustomChinese'
        elif os.path.exists("font.otf"):
            pdfmetrics.registerFont(TTFont('CustomChinese', 'font.otf'))
            font_name = 'CustomChinese'
    except: pass

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('CTitle', parent=styles['Heading1'], fontName=font_name, fontSize=16, leading=20)
    cell_style = ParagraphStyle('CCell', parent=styles['Normal'], fontName=font_name, fontSize=9, leading=11)
    
    df['dt'] = pd.to_datetime(df['Date'] + " " + df['Time'], errors='coerce')
    df = df.dropna(subset=['dt'])
    months = sorted(df['dt'].dt.to_period('M').unique())
    import calendar as py_calendar
    cal = py_calendar.Calendar(firstweekday=6)

    for period in months:
        year, month = period.year, period.month
        elements.append(Paragraph(f"<b>{period.strftime('%B %Y')}</b>", title_style))
        elements.append(Spacer(1, 10))
        
        month_cal = cal.monthdayscalendar(year, month)
        table_data = [["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]]
        row_heights = [20]

        for week in month_cal:
            row_cells = []
            max_entries = 0
            for day in week:
                if day == 0:
                    row_cells.append("")
                else:
                    day_str = f"{year}-{month:02d}-{day:02d}"
                    day_data = df[df['Date'] == day_str].sort_values('Time')
                    cell_text = f"<b>{day}</b>"
                    if not day_data.empty:
                        lines = [f"{r['Name']}\n{r['Time']}" for _, r in day_data.iterrows()]
                        cell_text += "\n\n" + "\n".join(lines)
                        max_entries = max(max_entries, len(day_data))
                    row_cells.append(Paragraph(cell_text.replace("\n", "<br/>"), cell_style))
            table_data.append(row_cells)
            row_heights.append(40 + (max_entries * 25))

        table = Table(table_data, colWidths=[110]*7, rowHeights=row_heights)
        table.setStyle(TableStyle([
            ('GRID', (0,0), (-1,-1), 0.5, colors.black),
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('BACKGROUND', (0,0), (-1,0), colors.lightgrey),
            ('FONTNAME', (0,0), (-1,-1), font_name), 
        ]))
        elements.append(table)
        elements.append(Spacer(1, 20))

    doc.build(elements)
    buffer.seek(0)
    return buffer

def generate_visual_excel(df):
    wb = Workbook()
    wb.remove(wb.active)
    thin = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
    align = Alignment(horizontal="center", vertical="top", wrap_text=True)
    import calendar as py_calendar
    cal = py_calendar.Calendar(firstweekday=6)
    
    df['dt'] = pd.to_datetime(df['Date'] + " " + df['Time'], errors='coerce')
    months = sorted(df['dt'].dt.to_period('M').dropna().unique())

    for period in months:
        ws = wb.create_sheet(f"{period.year}-{period.month:02d}")
        ws.merge_cells("A1:G1")
        ws["A1"] = f"{period.strftime('%B %Y')}"
        ws["A1"].font = Font(size=14, bold=True)
        ws["A1"].alignment = Alignment(horizontal="center")
        
        for i, d in enumerate(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], 1):
            c = ws.cell(2, i, d)
            c.fill = PatternFill("solid", fgColor="DDDDDD")
            c.font = Font(bold=True)
            c.alignment = Alignment(horizontal="center")
            ws.column_dimensions[chr(64+i)].width = 20

        row_num = 3
        for week in cal.monthdayscalendar(period.year, period.month):
            max_h = 1
            for col_idx, day in enumerate(week, 1):
                c = ws.cell(row_num, col_idx)
                c.border = thin
                c.alignment = align
                if day != 0:
                    day_str = f"{period.year}-{period.month:02d}-{day:02d}"
                    day_data = df[df['Date'] == day_str].sort_values('Time')
                    val = f"{day}\n"
                    if not day_data.empty:
                        lines = [f"{r['Name']} ({r['Time']})" for _, r in day_data.iterrows()]
                        val += "\n".join(lines)
                        max_h = max(max_h, len(lines)+1)
                    c.value = val
            ws.row_dimensions[row_num].height = max(50, max_h * 15)
            row_num += 1
            
    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return buffer

def generate_raw_excel(df):
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='RawData')
    buffer.seek(0)
    return buffer

# ================= MAIN APP LOGIC =================

initialize_session()
df = st.session_state.data

st.title("☁️ 雲端面試預約系統 (安全同步版)")

if st.button("🔄 立即同步 (強制更新最新資料)", type="primary"):
    refresh_data()
    st.rerun()

tab1, tab2, tab3 = st.tabs(["📅 月曆檢視", "📝 新增與編輯", "⚙️ 匯出與匯入"])

# --- TAB 1: CALENDAR ---
with tab1:
    if not df.empty:
        df_cal = df.reset_index(drop=True)
        events = []
        for index, row in df_cal.iterrows():
            if row['Date'] and row['Time'] and len(str(row['Date'])) == 10 and len(str(row['Time'])) == 5:
                try:
                    start_iso = f"{row['Date']}T{row['Time']}"
                    events.append({
                        "id": str(index), 
                        "title": row['Name'],
                        "start": start_iso,
                        "extendedProps": {"description": f"ID: {row['ID']} | Notes: {row['Notes']}"}
                    })
                except: continue
        
        calendar_key = f"calendar_{st.session_state.data_revision}"
        calendar(events=events, options={
            "initialView": "dayGridMonth",
            "height": "750px",
            "headerToolbar": {"left": "prev,next today", "center": "title", "right": "dayGridMonth,listMonth"},
            "eventTimeFormat": {"hour": "2-digit", "minute": "2-digit", "hour12": False},
            "handleWindowResize": True,
            "windowResizeDelay": 100
        }, key=calendar_key)
    else:
        st.info("目前沒有資料。")

# --- TAB 2: EDIT ---
with tab2:
    c1, c2 = st.columns([1, 2])
    with c1:
        st.subheader("➕ 新增預約")
        st.caption("此模式為「安全寫入」，會自動抓取雲端最新資料並合併，不會覆蓋他人資料。")
        
        st.info("👇 設定此時段的人數上限：")
        limit = st.number_input(
            "人數上限 (0 = 不限)", 
            min_value=0, 
            value=0, 
            help="如果設為 1，則該時段若已有人預約，系統會阻止新增。"
        )

        with st.form("add", clear_on_submit=False):
            form_id = st.session_state.form_id
            
            name = st.text_input("姓名", key=f"name_{form_id}")
            c_id = st.text_input("編號 (ID)", key=f"id_{form_id}")
            d = st.date_input("日期", min_value=datetime.today(), key=f"date_{form_id}")
            t_str = st.selectbox("時間 (09:00 - 21:30)", TIME_SLOTS, key=f"time_{form_id}")
            notes = st.text_area("備註", key=f"notes_{form_id}")
            
            if st.form_submit_button("💾 安全儲存至雲端"):
                if name:
                    limit_reached = False
                    if limit > 0:
                        check_date = d.strftime("%Y-%m-%d")
                        existing_count = len(df[
                            (df['Date'] == check_date) & 
                            (df['Time'] == t_str)
                        ])
                        if existing_count >= limit:
                            limit_reached = True
                            st.error(f"⛔ 時段 {check_date} {t_str} 已滿！(本地顯示: {existing_count}/{limit})")
                    
                    if not limit_reached:
                        new_row = pd.DataFrame([{"Name":name, "ID":c_id, "Date":d.strftime("%Y-%m-%d"), "Time":t_str, "Notes":notes}])
                        success = safe_add_record(new_row)
                        if success:
                            st.session_state.form_id += 1
                            st.rerun()
                else:
                    st.error("請輸入姓名")

    with c2:
        st.subheader("✏️ 編輯網格")
        st.warning("⚠️ 注意：多人同時使用時，編輯前請務必按上方的「同步」按鈕，以免覆蓋他人剛新增的資料。")
        st.caption("雙擊儲存格編輯，選取左側方塊並按 Delete 鍵可刪除。")
        
        edit_in = df.copy()
        edit_in["Date"] = pd.to_datetime(edit_in["Date"], errors='coerce').dt.date
        edit_in["Time"] = pd.to_datetime(edit_in["Time"], format='%H:%M', errors='coerce').dt.time
        
        out = st.data_editor(
            edit_in, 
            num_rows="dynamic", 
            use_container_width=True, 
            hide_index=True,
            column_config={
                "Time": st.column_config.TimeColumn("時間", format="HH:mm", step=1800),
                "Name": st.column_config.TextColumn("姓名"),
                "ID": st.column_config.TextColumn("編號"),
                "Date": st.column_config.DateColumn("日期", format="YYYY-MM-DD"),
                "Notes": st.column_config.TextColumn("備註"),
            }
        )
        
        if st.button("💾 儲存網格變更 (覆蓋模式)", type="secondary"):
            clean_out = out.copy()
            clean_out['Date'] = clean_out['Date'].apply(lambda x: x.strftime('%Y-%m-%d') if pd.notnull(x) else '')
            clean_out['Time'] = clean_out['Time'].apply(lambda x: x.strftime('%H:%M') if pd.notnull(x) else '')
            confirm_save_dialog(clean_out)

# --- TAB 3: EXPORT ---
with tab3:
    col1, col2 = st.columns(2)
    with col1:
        st.markdown("### 📊 視覺化報表")
        st.caption("此處匯出的檔案適合列印與張貼。")
        if not df.empty:
            st.download_button("📄 下載 PDF 月曆", generate_visual_pdf(df), "calendar.pdf", "application/pdf")
            st.download_button("🗓️ 下載 Excel 月曆 (排版)", generate_visual_excel(df), "calendar_view.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    
    with col2:
        st.markdown("### 💾 資料備份與還原")
        st.caption("支援 Excel (.xlsx) 格式。")
        if not df.empty:
            st.download_button("📥 下載完整資料表 (.xlsx)", generate_raw_excel(df), "raw_data.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            
        st.divider()
        
        st.markdown("#### 📥 匯入資料功能 (新增至現有資料)")
        st.caption("請上傳 .xlsx 檔案，系統會將新資料附加到現有資料庫中。")
        up = st.file_uploader("上傳 Excel 檔", type="xlsx")
        
        if up and st.button("開始匯入"):
            try:
                imp = pd.read_excel(up, dtype=str)
                imp = imp.fillna("")
                
                if 'Name' in imp.columns:
                    success = safe_add_record(imp)
                    if success:
                        st.success("✅ 匯入成功！資料已新增。")
                        st.rerun()
                else:
                    st.error("❌ 格式錯誤：Excel 檔案中缺少 'Name' (姓名) 欄位。")
            except Exception as e:
                st.error(f"❌ 讀取 Excel 失敗: {e}")
