"""
SimpleC v2 - AI-powered QA Test Generator.
"""

import os
import sys
import streamlit as st
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "db"))
sys.path.insert(0, str(ROOT / "agents"))

from agents.llm_client import LLMClient, Message
from agents.layered_generator import LayeredGenerator, TestCaseMarkdown
from agents.prompt_templates import PromptTemplateManager
from file_parser import parse_file
from feedback_store import FeedbackStore
from secure_config import SecureConfig
from prompt_guard import sanitize_input
from team_store import TeamStore
from tc_formatter import parse_test_cases_from_xml, cases_to_csv

st.set_page_config(page_title="SimpleTest", page_icon="\U0001f9ea", layout="wide", initial_sidebar_state="expanded")

st.markdown("""
<style>
    /* ── Base & Background ── */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

    html, body, [class*="css"] { font-family: 'Inter', -apple-system, sans-serif !important; }

    /* Hide Streamlit black header & toolbar */
    header[data-testid="stHeader"] { display: none !important; }
    [data-testid="stToolbar"] { display: none !important; }
    #MainMenu { display: none !important; }
    footer { display: none !important; }

    .stApp {
        background: linear-gradient(135deg, #eef2ff 0%, #f0f9ff 40%, #faf5ff 100%) !important;
        min-height: 100vh;
    }

    /* Push content up since header is hidden */
    .block-container { padding-top: 2rem !important; }

    /* ── Glass card helper ── */
    .glass-card {
        background: rgba(255,255,255,0.65);
        backdrop-filter: blur(24px);
        -webkit-backdrop-filter: blur(24px);
        border: 1px solid rgba(255,255,255,0.75);
        border-radius: 20px;
        box-shadow: 0 4px 24px rgba(99,102,241,0.07), 0 1px 4px rgba(0,0,0,0.04);
        padding: 24px;
        margin: 8px 0;
    }

    /* ── Sidebar ── */
    [data-testid="stSidebar"], [data-testid="stSidebar"] > div {
        background: rgba(255,255,255,0.72) !important;
        backdrop-filter: blur(28px) !important;
        -webkit-backdrop-filter: blur(28px) !important;
        border-right: 1px solid rgba(99,102,241,0.1) !important;
    }

    /* ── Buttons ── */
    .stButton > button {
        background: rgba(255,255,255,0.8) !important;
        color: #4F46E5 !important;
        border: 1px solid rgba(99,102,241,0.25) !important;
        border-radius: 12px !important;
        font-weight: 600 !important;
        font-size: 14px !important;
        padding: 10px 22px !important;
        white-space: nowrap !important;
        box-shadow: 0 2px 8px rgba(99,102,241,0.08) !important;
        transition: all 0.2s ease !important;
        letter-spacing: 0.01em !important;
    }
    .stButton > button:hover {
        background: rgba(99,102,241,0.06) !important;
        border-color: rgba(99,102,241,0.45) !important;
        box-shadow: 0 4px 16px rgba(99,102,241,0.14) !important;
        transform: translateY(-1px) !important;
    }
    .stButton > button[kind="primary"] {
        background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%) !important;
        color: #ffffff !important;
        border: none !important;
        box-shadow: 0 4px 16px rgba(99,102,241,0.30) !important;
    }
    .stButton > button[kind="primary"]:hover {
        background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%) !important;
        box-shadow: 0 6px 24px rgba(99,102,241,0.38) !important;
        transform: translateY(-1px) !important;
    }

    /* ── Gear icon button ── */
    [data-testid="stSidebar"] [data-testid="stHorizontalBlock"]:first-of-type
        [data-testid="stColumn"]:last-child .stButton > button {
        background: rgba(255,255,255,0.7) !important;
        border: 1px solid rgba(99,102,241,0.20) !important;
        border-radius: 50% !important;
        width: 34px !important;
        height: 34px !important;
        min-height: unset !important;
        padding: 0 !important;
        font-size: 16px !important;
        line-height: 1 !important;
        box-shadow: 0 2px 6px rgba(99,102,241,0.08) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        white-space: nowrap !important;
        font-family: sans-serif !important;
    }
    [data-testid="stSidebar"] [data-testid="stHorizontalBlock"]:first-of-type
        [data-testid="stColumn"]:last-child .stButton > button:hover {
        background: rgba(99,102,241,0.10) !important;
        border-color: rgba(99,102,241,0.40) !important;
        transform: none !important;
    }

    /* ── LLM Settings panel ── */
    .settings-panel {
        background: rgba(255,255,255,0.75);
        border: 1px solid rgba(99,102,241,0.18);
        border-radius: 14px;
        padding: 14px 14px 6px;
        margin: 6px 0 10px;
        backdrop-filter: blur(12px);
    }
    .llm-provider-row {
        display: flex;
        align-items: baseline;
        gap: 6px;
        margin-bottom: 6px;
        flex-wrap: wrap;
    }
    .llm-provider-name {
        font-size: 12px;
        font-weight: 700;
        color: #6366F1;
    }
    .llm-provider-key {
        font-size: 11px;
        color: #64748b;
        font-family: monospace;
    }
    .llm-provider-scope {
        font-size: 10px;
        color: #94a3b8;
        background: rgba(99,102,241,0.07);
        border-radius: 4px;
        padding: 1px 5px;
    }

    /* ── Download buttons ── */
    .stDownloadButton > button {
        background: rgba(255,255,255,0.8) !important;
        color: #6366F1 !important;
        border: 1px solid rgba(99,102,241,0.25) !important;
        border-radius: 12px !important;
        font-weight: 600 !important;
        box-shadow: 0 2px 8px rgba(99,102,241,0.08) !important;
        transition: all 0.2s ease !important;
    }
    .stDownloadButton > button:hover {
        background: rgba(99,102,241,0.06) !important;
        box-shadow: 0 4px 16px rgba(99,102,241,0.14) !important;
        transform: translateY(-1px) !important;
    }

    /* ── Inputs & Textareas ── */
    .stTextInput > div > div > input,
    .stTextArea > div > div > textarea,
    input[type="text"], input[type="number"], input[type="search"], textarea {
        background: rgba(255,255,255,0.85) !important;
        border: 1px solid rgba(99,102,241,0.2) !important;
        border-radius: 12px !important;
        color: #1E1B4B !important;
        box-shadow: 0 1px 4px rgba(99,102,241,0.06) !important;
        transition: border-color 0.2s, box-shadow 0.2s !important;
        font-size: 14px !important;
    }
    .stTextInput > div > div > input:focus,
    .stTextArea > div > div > textarea:focus {
        border-color: #6366F1 !important;
        box-shadow: 0 0 0 3px rgba(99,102,241,0.12) !important;
        outline: none !important;
    }
    /* Fix gray wrapper around text input AND textarea */
    .stTextInput > div,
    .stTextInput > div > div,
    .stTextArea > div,
    .stTextArea > div > div {
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
    }

    /* ── Selectbox / Multiselect ── */
    .stSelectbox > div > div,
    .stMultiSelect > div > div {
        background: rgba(255,255,255,0.8) !important;
        border: 1px solid rgba(99,102,241,0.18) !important;
        border-radius: 12px !important;
        box-shadow: 0 1px 4px rgba(99,102,241,0.06) !important;
    }
    .stSelectbox [data-baseweb="select"] span,
    .stSelectbox [data-baseweb="select"] div,
    .stMultiSelect [data-baseweb="select"] span,
    .stMultiSelect [data-baseweb="select"] div { color: #1E1B4B !important; }
    .stSelectbox svg, .stMultiSelect svg { fill: #6366F1 !important; }
    /* Dropdown popover — must override dark Streamlit default */
    [data-baseweb="popover"],
    [data-baseweb="popover"] > div,
    [data-baseweb="popover"] > div > div {
        background: #ffffff !important;
        border: 1px solid rgba(99,102,241,0.15) !important;
        border-radius: 14px !important;
        box-shadow: 0 12px 40px rgba(99,102,241,0.15) !important;
    }
    [data-baseweb="menu"],
    [data-baseweb="list"],
    ul[data-baseweb="menu"] {
        background: #ffffff !important;
    }
    [role="option"],
    li[role="option"] {
        background: #ffffff !important;
        color: #374151 !important;
        border-radius: 8px !important;
    }
    [role="option"]:hover,
    li[role="option"]:hover { background: rgba(99,102,241,0.07) !important; color: #4F46E5 !important; }
    [aria-selected="true"],
    li[aria-selected="true"] { background: rgba(99,102,241,0.1) !important; color: #4F46E5 !important; }
    .stMultiSelect [data-baseweb="tag"] {
        background: linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.12)) !important;
        color: #4F46E5 !important;
        border: 1px solid rgba(99,102,241,0.2) !important;
        border-radius: 8px !important;
    }
    .stMultiSelect span { color: #4F46E5 !important; }

    /* ── File uploader ── */
    [data-testid="stFileUploader"] > div,
    [data-testid="stFileUploaderDropzone"] {
        background: rgba(255,255,255,0.75) !important;
        border-radius: 16px !important;
        border: 2px dashed rgba(99,102,241,0.3) !important;
        transition: border-color 0.2s, background 0.2s !important;
    }
    [data-testid="stFileUploaderDropzone"]:hover {
        border-color: rgba(99,102,241,0.55) !important;
        background: rgba(99,102,241,0.04) !important;
    }
    /* Fix dark inner area of file uploader */
    [data-testid="stFileUploaderDropzone"] > div,
    [data-testid="stFileUploaderDropzoneInstructions"] {
        background: transparent !important;
    }
    [data-testid="stFileUploaderDropzone"] span,
    [data-testid="stFileUploaderDropzone"] p,
    [data-testid="stFileUploaderDropzone"] small {
        color: #374151 !important;
    }
    /* Browse files button */
    [data-testid="stFileUploaderDropzone"] button {
        background: rgba(255,255,255,0.92) !important;
        color: #4F46E5 !important;
        border: 1px solid rgba(99,102,241,0.3) !important;
        border-radius: 10px !important;
        font-weight: 600 !important;
        font-size: 13px !important;
        padding: 7px 16px !important;
        box-shadow: 0 2px 8px rgba(99,102,241,0.1) !important;
        transition: all 0.2s !important;
    }
    [data-testid="stFileUploaderDropzone"] button:hover {
        background: rgba(99,102,241,0.06) !important;
        border-color: rgba(99,102,241,0.5) !important;
    }
    [data-testid="stFileUploaderDropzone"] svg { fill: #6366F1 !important; }

    /* ── Tabs ── */
    /* Tab container background — multiple selectors for different Streamlit versions */
    .stTabs [data-baseweb="tab-list"],
    .stTabs [role="tablist"],
    div[data-testid="stTabs"] > div:first-child > div {
        background: rgba(255,255,255,0.72) !important;
        backdrop-filter: blur(16px) !important;
        -webkit-backdrop-filter: blur(16px) !important;
        border: 1px solid rgba(255,255,255,0.9) !important;
        border-radius: 14px !important;
        padding: 5px !important;
        gap: 4px !important;
        box-shadow: 0 2px 16px rgba(99,102,241,0.09) !important;
    }
    .stTabs [data-baseweb="tab"],
    .stTabs [role="tab"] {
        background: transparent !important;
        border-radius: 10px !important;
        color: #6B7280 !important;
        font-weight: 500 !important;
        font-size: 14px !important;
        transition: all 0.2s !important;
        border: none !important;
        padding: 7px 18px !important;
    }
    .stTabs [data-baseweb="tab"]:hover,
    .stTabs [role="tab"]:hover {
        background: rgba(99,102,241,0.07) !important;
        color: #4F46E5 !important;
    }
    .stTabs [aria-selected="true"] {
        background: white !important;
        color: #4F46E5 !important;
        font-weight: 600 !important;
        box-shadow: 0 2px 8px rgba(99,102,241,0.12) !important;
        border: none !important;
    }
    /* Remove default underline indicator */
    .stTabs [data-baseweb="tab-highlight"],
    .stTabs [data-baseweb="tab-border"] { display: none !important; }

    /* ── Toggle ── */
    .stToggle > label,
    [data-testid="stToggle"] p { color: #374151 !important; }
    /* Native Streamlit toggle track — off */
    [data-testid="stToggle"] > label > div:first-of-type {
        background-color: #CBD5E1 !important;
        border-color: #CBD5E1 !important;
    }
    /* Native Streamlit toggle track — on */
    [data-testid="stToggle"] > label > div[data-checked="true"],
    [data-testid="stToggle"] input:checked + div {
        background-color: #6366F1 !important;
        border-color: #6366F1 !important;
    }

    /* ── Metrics ── */
    [data-testid="stMetricValue"] {
        color: #4F46E5 !important;
        font-weight: 700 !important;
        font-size: 28px !important;
    }
    [data-testid="stMetricLabel"] { color: #6B7280 !important; font-size: 12px !important; }
    [data-testid="stMetric"] {
        background: rgba(255,255,255,0.65) !important;
        border: 1px solid rgba(99,102,241,0.12) !important;
        border-radius: 16px !important;
        padding: 16px 20px !important;
        box-shadow: 0 2px 8px rgba(99,102,241,0.06) !important;
    }

    /* ── Labels ── */
    .stSelectbox label, .stTextInput label, .stTextArea label,
    .stMultiSelect label, .stFileUploader label {
        color: #374151 !important;
        font-weight: 500 !important;
        font-size: 13px !important;
        letter-spacing: 0.01em !important;
    }

    /* ── Headings ── */
    h1 { color: #1E1B4B !important; font-weight: 700 !important; letter-spacing: -0.02em !important; }
    h2 { color: #1E1B4B !important; font-weight: 600 !important; }
    h3 { color: #312E81 !important; font-weight: 600 !important; }
    h4 { color: #4338CA !important; font-weight: 500 !important; }
    p, li { color: #374151 !important; }
    code { color: #4F46E5 !important; background: rgba(99,102,241,0.08) !important; border-radius: 4px !important; }

    /* ── Markdown tables ── */
    table {
        border-collapse: collapse !important;
        width: 100% !important;
        margin: 12px 0 !important;
        background: rgba(255,255,255,0.7) !important;
        border-radius: 12px !important;
        overflow: hidden !important;
    }
    thead tr { background: rgba(99,102,241,0.08) !important; }
    th {
        color: #312E81 !important;
        font-weight: 600 !important;
        font-size: 13px !important;
        padding: 10px 14px !important;
        text-align: left !important;
        border-bottom: 1px solid rgba(99,102,241,0.15) !important;
    }
    td {
        color: #374151 !important;
        font-size: 14px !important;
        padding: 9px 14px !important;
        border-bottom: 1px solid rgba(99,102,241,0.07) !important;
    }
    tbody tr:last-child td { border-bottom: none !important; }
    tbody tr:hover { background: rgba(99,102,241,0.04) !important; }

    /* ── Expanders ── */
    [data-testid="stExpander"] {
        background: rgba(255,255,255,0.6) !important;
        border: 1px solid rgba(255,255,255,0.75) !important;
        border-radius: 16px !important;
        backdrop-filter: blur(16px) !important;
        box-shadow: 0 2px 8px rgba(99,102,241,0.05) !important;
        margin: 6px 0 !important;
    }
    [data-testid="stExpander"] summary {
        color: #374151 !important;
        font-weight: 500 !important;
    }

    /* ── Progress bar ── */
    [data-testid="stProgress"] > div > div {
        background: linear-gradient(90deg, #6366F1, #8B5CF6) !important;
        border-radius: 99px !important;
    }
    [data-testid="stProgress"] > div {
        background: rgba(99,102,241,0.1) !important;
        border-radius: 99px !important;
    }

    /* ── Info / Warning / Error / Success ── */
    [data-testid="stAlert"] {
        border-radius: 14px !important;
        border: none !important;
        backdrop-filter: blur(12px) !important;
    }

    /* ── Logo & branding ── */
    .logo-container {
        display: flex; align-items: center; gap: 14px;
        padding: 18px 20px; margin-bottom: 20px;
        background: rgba(255,255,255,0.7);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255,255,255,0.8);
        border-radius: 20px;
        box-shadow: 0 4px 20px rgba(99,102,241,0.08);
    }
    .logo-icon {
        width: 44px; height: 44px;
        background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%);
        border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        font-size: 18px; font-weight: 700; color: #fff;
        box-shadow: 0 4px 12px rgba(99,102,241,0.30);
        letter-spacing: -0.03em;
    }
    .logo-title {
        font-size: 20px; font-weight: 700;
        background: linear-gradient(135deg, #4F46E5, #7C3AED);
        -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        letter-spacing: -0.02em; line-height: 1.2;
    }
    .logo-sub {
        font-size: 11px; color: #9CA3AF; font-weight: 400;
        margin-top: 2px; letter-spacing: 0.02em;
    }

    /* ── Section header ── */
    .section-header {
        color: #6B7280;
        font-size: 11px; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.08em;
        margin: 24px 0 10px 0; padding-bottom: 6px;
        border-bottom: 1px solid rgba(99,102,241,0.12);
    }

    /* ── LLM status bar ── */
    .llm-status-bar { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
    .llm-dot {
        display: inline-flex !important; align-items: center !important; gap: 6px !important;
        font-size: 12px !important; color: #4B5563 !important; font-weight: 500 !important;
        background: rgba(255,255,255,0.85) !important;
        border: 1px solid rgba(99,102,241,0.15) !important;
        border-radius: 20px !important; padding: 5px 12px !important;
        backdrop-filter: blur(8px) !important;
        box-shadow: 0 1px 4px rgba(99,102,241,0.07) !important;
    }
    .llm-dot .dot { width: 7px; height: 7px; border-radius: 50%; }
    .llm-dot .dot.green { background: #10B981; box-shadow: 0 0 6px rgba(16,185,129,0.5); }
    .llm-dot .dot.yellow { background: #F59E0B; box-shadow: 0 0 6px rgba(245,158,11,0.5); }
    .llm-dot .dot.red { background: #EF4444; box-shadow: 0 0 6px rgba(239,68,68,0.5); }
    .llm-dot .dot.off { background: #D1D5DB; }

    /* ── Divider softening ── */
    hr { border-color: rgba(99,102,241,0.1) !important; }

    /* ── Scrollbar ── */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.2); border-radius: 99px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(99,102,241,0.35); }
</style>
""", unsafe_allow_html=True)

env_issues = SecureConfig.validate_env()
for issue in env_issues:
    if "CRITICAL" in issue:
        st.error(issue)


@st.cache_resource
def init_feedback():
    return FeedbackStore()


feedback = init_feedback()

AC_LIST = [
    "РМДС [CI04663743]",
    "ППРБ [CI04663744]",
    "СББОЛ [CI04663745]",
    "Omega [CI04663746]",
    "Сигма [CI04663747]",
]

DEPTH_OPTIONS = {
    "Smoke (1-5 e2e)": "smoke",
    "Regression (5-10)": "regression",
    "Full (11-30)": "full",
    "Atomary (31-100)": "atomary",
}

defaults = {
    "stage": "input",
    "qa_doc": None,
    "case_list": None,
    "md_cases": None,
    "requirement_text": "",
    "detected_types": None,
    "feedback_given": False,
    "xml_result": None,
    "feature": "INCIDENT",
    "selected_provider": None,
    "show_etalon_form": False,
    "bug_report_result": None,
    "show_llm_settings": False,
}
for key, val in defaults.items():
    if key not in st.session_state:
        st.session_state[key] = val

def _save_env_key(key_name: str, value: str):
    """Write or update a single key in the .env file."""
    env_path = Path(".env")
    lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
    found = False
    new_lines = []
    for line in lines:
        if line.startswith(key_name + "="):
            new_lines.append(f"{key_name}={value}")
            found = True
        else:
            new_lines.append(line)
    if not found:
        new_lines.append(f"{key_name}={value}")
    env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    os.environ[key_name] = value


with st.sidebar:
    # ── First-run setup wizard ──────────────────────────────────
    gigachat_key = os.getenv("GIGACHAT_AUTH_KEY", "").strip()
    if not gigachat_key:
        st.error("GigaChat ключ не настроен")
        with st.expander("⚙️ Первичная настройка", expanded=True):
            st.markdown("Введите `GIGACHAT_AUTH_KEY` (Base64 строка из личного кабинета Sber).")
            new_key = st.text_input("GIGACHAT_AUTH_KEY", type="password", placeholder="MDE5YmQx...")
            new_scope = st.selectbox("Scope", ["GIGACHAT_API_PERS", "GIGACHAT_API_CORP"], index=0)
            deepseek_key = st.text_input("DEEPSEEK_API_KEY (опционально)", type="password")
            if st.button("Сохранить настройки", type="primary"):
                if new_key.strip():
                    _save_env_key("GIGACHAT_AUTH_KEY", new_key.strip())
                    _save_env_key("GIGACHAT_SCOPE", new_scope)
                    if deepseek_key.strip():
                        _save_env_key("DEEPSEEK_API_KEY", deepseek_key.strip())
                    st.success("Настройки сохранены! Перезапускаю...")
                    st.rerun()
                else:
                    st.warning("Введите ключ GigaChat")
        st.stop()

    providers = LLMClient.get_available_providers()

    # Health check with 30s cache
    @st.cache_data(ttl=30)
    def _ping_providers():
        results = {}
        for p in providers:
            if p["status"] == "ready":
                hc = LLMClient.health_check(p["id"])
                results[p["id"]] = hc
            else:
                results[p["id"]] = {"status": "red", "message": "Нет ключа"}
        return results

    health = _ping_providers()

    status_html = '<div class="llm-status-bar">'
    for p in providers:
        hc = health.get(p["id"], {"status": "red", "message": "?"})
        dot_class = hc["status"]
        name_short = p["name"]
        tooltip = hc["message"]
        status_html += '<span class="llm-dot" title="' + tooltip + '"><span class="dot ' + dot_class + '"></span>' + name_short + '</span>'
    status_html += '</div>'

    # Status bar + gear icon on same row
    _col_status, _col_gear = st.columns([7, 1])
    with _col_status:
        st.markdown(status_html, unsafe_allow_html=True)
    with _col_gear:
        gear_label = "⚙" if not st.session_state.show_llm_settings else "✕"
        if st.button(gear_label, key="btn_gear", help="Настройки LLM"):
            st.session_state.show_llm_settings = not st.session_state.show_llm_settings
            st.rerun()

    # ── LLM Settings panel (toggle) ─────────────────────────────
    def _mask_key(val: str) -> str:
        if not val:
            return "не задан"
        return "••••••••" + val[-4:]

    if st.session_state.show_llm_settings:
        gc_key_val = os.getenv("GIGACHAT_AUTH_KEY", "")
        gc_scope_val = os.getenv("GIGACHAT_SCOPE", "GIGACHAT_API_PERS")
        ds_key_val = os.getenv("DEEPSEEK_API_KEY", "")

        st.markdown("""
        <div class="settings-panel">
            <div style="font-size:11px;font-weight:700;color:#6366F1;
                        text-transform:uppercase;letter-spacing:.06em;
                        margin-bottom:10px">Настройки LLM</div>
        </div>
        """, unsafe_allow_html=True)

        # GigaChat
        st.markdown(f"""
        <div class="llm-provider-row">
          <span class="llm-provider-name">GigaChat</span>
          <span class="llm-provider-key">{_mask_key(gc_key_val)}</span>
          <span class="llm-provider-scope">{gc_scope_val}</span>
        </div>""", unsafe_allow_html=True)
        inp_gc = st.text_input("Ключ GigaChat", type="password",
                               placeholder="MDE5YmQx...", key="inp_gc",
                               label_visibility="collapsed")
        inp_scope = st.selectbox("Scope GigaChat",
                                 ["GIGACHAT_API_PERS", "GIGACHAT_API_CORP"],
                                 index=0 if gc_scope_val == "GIGACHAT_API_PERS" else 1,
                                 key="inp_gc_scope",
                                 label_visibility="collapsed")
        if st.button("Сохранить GigaChat", key="btn_gc", use_container_width=True):
            if inp_gc.strip():
                _save_env_key("GIGACHAT_AUTH_KEY", inp_gc.strip())
                _save_env_key("GIGACHAT_SCOPE", inp_scope)
                st.session_state.show_llm_settings = False
                st.rerun()
            else:
                st.warning("Введите ключ")

        st.markdown("<hr style='margin:10px 0;border-color:rgba(99,102,241,.12)'>",
                    unsafe_allow_html=True)

        # DeepSeek
        st.markdown(f"""
        <div class="llm-provider-row">
          <span class="llm-provider-name">DeepSeek</span>
          <span class="llm-provider-key">{_mask_key(ds_key_val)}</span>
        </div>""", unsafe_allow_html=True)
        inp_ds = st.text_input("Ключ DeepSeek", type="password",
                               placeholder="sk-...", key="inp_ds",
                               label_visibility="collapsed")
        if st.button("Сохранить DeepSeek", key="btn_ds", use_container_width=True):
            if inp_ds.strip():
                _save_env_key("DEEPSEEK_API_KEY", inp_ds.strip())
                st.session_state.show_llm_settings = False
                st.rerun()
            else:
                st.warning("Введите ключ")

    st.markdown("""
    <div class="logo-container">
        <div class="logo-icon">ST</div>
        <div>
            <div class="logo-title">SimpleTest</div>
            <div class="logo-sub">AI Test Generator · v2</div>
        </div>
    </div>
    """, unsafe_allow_html=True)

    ready_providers = [p for p in providers if p["status"] == "ready"]
    if ready_providers:
        provider_names = {p["id"]: p["name"] for p in providers}
        selected_provider = st.selectbox(
            "Модель", options=[p["id"] for p in ready_providers],
            format_func=lambda x: provider_names.get(x, x), key="llm_provider"
        )
    else:
        st.warning("Нет доступных LLM")
        selected_provider = None

    depth_choice = st.selectbox("Глубина", options=list(DEPTH_OPTIONS.keys()), index=0)
    depth_key = DEPTH_OPTIONS[depth_choice]

    st.markdown('<div class="section-header">Настройки</div>', unsafe_allow_html=True)
    feature = st.text_input("Фича", value="INCIDENT")

    # Save to session state to persist across reruns
    st.session_state.feature = feature
    if selected_provider:
        st.session_state.selected_provider = selected_provider

    fb_stats = feedback.get_stats()
    if fb_stats["total"] > 0:
        st.markdown('<div class="section-header">Качество</div>', unsafe_allow_html=True)
        c1, c2 = st.columns(2)
        c1.metric("Оценок", fb_stats["total"])
        c2.metric("Позитивных", fb_stats["positive"])



tab1, tab2, tab3, tab4 = st.tabs(["Генерация", "Эталоны", "Дефекты", "О системе"])

with tab1:
    stage = st.session_state.stage

    if stage == "input":
        st.markdown("### Загрузка требований")
        requirement = ""
        use_text = st.toggle("Ввести текст вручную", value=False)

        if use_text:
            requirement = st.text_area("Требование:", height=200, placeholder="Вставьте текст...")
        else:
            uploaded = st.file_uploader(
                "Загрузите файлы:",
                type=["pdf", "docx", "doc", "xlsx", "xls", "xml", "png", "jpg", "jpeg", "txt"],
                accept_multiple_files=True
            )
            if uploaded:
                texts = []
                for uf in uploaded:
                    try:
                        text = parse_file(uf.read(), uf.name)
                        texts.append(text)
                        with st.expander(uf.name + " (" + str(len(text)) + " sym)"):
                            st.text(text[:2000])
                    except Exception as e:
                        st.error(str(uf.name) + ": " + str(e))
                if texts:
                    requirement = "\n\n".join(texts)

        col_gen, _ = st.columns([1, 4])
        with col_gen:
            btn = st.button("Генерировать", type="primary")

        if btn and requirement and selected_provider:
            check = sanitize_input(requirement)
            for w in check.get("warnings", []):
                st.warning(w)

            req_text = check["text"]
            detected = PromptTemplateManager.detect_type(req_text)
            type_names = PromptTemplateManager.get_template_names()
            det_str = ", ".join([type_names.get(t, t) for t in detected])
            st.info("Тип: " + det_str)

            llm = LLMClient(selected_provider)
            gen = LayeredGenerator(llm)
            progress = st.progress(0, text="Слой 1: QA документация...")

            qa_doc = gen.generate_qa_doc(req_text, feature)
            progress.progress(30, text="Слой 2: Список кейсов...")

            case_list = gen.generate_case_list(qa_doc, depth_key, "", feature)
            progress.progress(50, text="Слой 3: Детальные кейсы...")

            md_cases = []
            total = len(case_list)
            for i, case_info in enumerate(case_list):
                pct = 50 + int(45 * (i + 1) / max(total, 1))
                cname = case_info.get("name", "")[:40]
                progress.progress(pct, text="Кейс " + str(i+1) + "/" + str(total) + ": " + cname)
                tc = gen.generate_case_markdown(case_info, qa_doc, depth=depth_key)
                md_cases.append(tc)

            progress.progress(100, text="Готово!")

            st.session_state.qa_doc = qa_doc
            st.session_state.case_list = case_list
            st.session_state.md_cases = md_cases
            st.session_state.requirement_text = req_text
            st.session_state.detected_types = detected
            st.session_state.feedback_given = False
            st.session_state.stage = "review"
            st.rerun()

        elif btn and not requirement:
            st.warning("Загрузите файл или введите текст")
        elif btn and not selected_provider:
            st.error("Нет доступных LLM")

    elif stage == "review":
        qa_doc = st.session_state.qa_doc
        md_cases = st.session_state.md_cases
        feature = st.session_state.feature

        st.markdown("### QA Документация")
        st.markdown(qa_doc)

        st.markdown("---")
        count = str(len(md_cases))
        st.markdown("### Тест-кейсы (" + count + " шт.)")

        for i, tc in enumerate(md_cases, 1):
            expanded = (i <= 3)
            label = str(i) + ". " + tc.name + " [" + tc.priority + "]"
            with st.expander(label, expanded=expanded):
                st.markdown(tc.to_markdown())

        st.markdown("---")

        if not st.session_state.feedback_given:
            st.markdown("### Оцените результат")
            col_like, col_dislike, col_reset = st.columns([1, 1, 1])

            with col_like:
                if st.button("Принять", key="btn_like", type="primary"):
                    preview = md_cases[0].to_markdown()[:500] if md_cases else ""
                    feedback.add_feedback(
                        generation_type="layered", rating="positive",
                        requirement_preview=st.session_state.requirement_text[:500],
                        result_preview=preview, platform="", feature=feature,
                        test_cases_count=len(md_cases),
                    )
                    st.session_state.feedback_given = True
                    st.session_state.stage = "export"
                    st.rerun()

            with col_dislike:
                if st.button("Отклонить", key="btn_dislike"):
                    preview = md_cases[0].to_markdown()[:500] if md_cases else ""
                    feedback.add_feedback(
                        generation_type="layered", rating="negative",
                        requirement_preview=st.session_state.requirement_text[:500],
                        result_preview=preview, platform="", feature=feature,
                        test_cases_count=len(md_cases),
                    )
                    for key, val in defaults.items():
                        st.session_state[key] = val
                    st.rerun()

            with col_reset:
                if st.button("Новая генерация", key="btn_new_review"):
                    for key, val in defaults.items():
                        st.session_state[key] = val
                    st.rerun()

    elif stage == "export":
        md_cases = st.session_state.md_cases
        qa_doc = st.session_state.qa_doc
        count = str(len(md_cases))

        # Use feature from session_state for consistency
        feature = st.session_state.feature
        selected_provider = st.session_state.selected_provider

        st.markdown("### Экспорт — Обвязка в Zephyr XML")

        # --- Materials for review/copy ---
        with st.expander("QA Документация (для копирования)", expanded=False):
            st.markdown(qa_doc)
            st.download_button(
                label="Скачать QA doc (.md)",
                data=qa_doc,
                file_name=feature + "_qa_doc.md",
                mime="text/markdown",
                key="dl_qa_doc_export"
            )

        with st.expander("Тест-кейсы Markdown (для копирования)", expanded=False):
            for idx, tc in enumerate(md_cases, 1):
                st.markdown("**" + str(idx) + ". " + tc.name + "** [" + tc.priority + "]")
                st.markdown(tc.to_markdown())
                st.markdown("---")
            md_text_all = "\n\n---\n\n".join([tc.to_markdown() for tc in md_cases])
            st.download_button(
                label="Скачать все кейсы (.md)",
                data=md_text_all,
                file_name=feature + "_cases.md",
                mime="text/markdown",
                key="dl_md_export"
            )

        st.markdown("---")
        st.markdown("### Настройки XML")
        st.info("Кейсов к обвязке: " + count + ". После нажатия LLM обвяжет каждый кейс в XML с HTML разметкой.")

        col1, col2 = st.columns(2)
        with col1:
            project = st.text_input("Проект", value="SBER911", key="xml_project")
            team_list = TeamStore.get_display_list()
            team = st.selectbox("Команда", options=team_list, key="xml_team")
            system = st.selectbox("АС", options=AC_LIST, key="xml_system")

        with col2:
            domain = st.multiselect(
                "Домен", options=["Omega", "Sigma", "Mobile"],
                default=["Omega"], key="xml_domain"
            )
            folder = st.text_input("Папка", value="Новая ТМ", key="xml_folder")

        domain_str = ", ".join(domain) if domain else "Omega"
        st.markdown("---")

        xml_result = st.session_state.xml_result

        if xml_result is None:
            col_wrap, col_skip, col_new = st.columns([1, 1, 1])

            with col_wrap:
                btn_wrap = st.button("Обвязать через LLM", key="btn_wrap", type="primary")

            with col_skip:
                btn_skip = st.button("Быстрый XML (без LLM)", key="btn_skip")

            with col_new:
                if st.button("Новая генерация", key="btn_new_export"):
                    for key, val in defaults.items():
                        st.session_state[key] = val
                    st.rerun()

            if btn_wrap:
                llm_client = LLMClient(selected_provider)
                if not selected_provider:
                    st.error("LLM не доступен")
                else:
                    gen_wrap = LayeredGenerator(llm_client)
                    progress_bar = st.progress(0, text="Обвязка кейсов...")
                    status_text = st.empty()

                    def update_progress(i, total, name):
                        progress_bar.progress((i + 1) / total, text="Обвязка: " + str(i + 1) + "/" + str(total))
                        status_text.text("Обвязка: " + name)

                    xml_text = gen_wrap.wrap_all_cases_via_llm(
                        md_cases, qa_doc, project=project, system=system,
                        team=team, domain=domain_str, folder=folder,
                        progress_callback=update_progress
                    )
                    progress_bar.progress(1.0, text="Готово!")
                    status_text.text("Обвязка завершена!")
                    st.session_state.xml_result = xml_text
                    st.rerun()

            if btn_skip:
                gen_simple = LayeredGenerator(None)
                xml_text = gen_simple.cases_to_xml(
                    md_cases, project=project, system=system,
                    team=team, domain=domain_str, folder=folder
                )
                st.session_state.xml_result = xml_text
                st.rerun()

        else:
            st.success("XML готов! Кейсов: " + count)

            ts = datetime.now().strftime("%Y%m%d_%H%M%S")

            col_xml, col_csv, col_md2, col_new = st.columns([1, 1, 1, 1])

            with col_xml:
                st.download_button(
                    label="XML (Zephyr)", data=xml_result,
                    file_name=feature + "_" + ts + ".xml",
                    mime="application/xml", key="dl_xml"
                )

            with col_csv:
                csv_cases = []
                for tc in md_cases:
                    steps = []
                    for s in tc.steps:
                        exp = "UI: " + s["ui"] + " | API: " + s["api"] + " | DB: " + s["db"]
                        steps.append({"action": s["action"], "test_data": s["test_data"], "expected": exp})
                    csv_cases.append({"name": tc.name, "steps": steps})
                csv_data = cases_to_csv(csv_cases)
                st.download_button(
                    label="CSV", data=csv_data,
                    file_name=feature + "_" + ts + ".csv",
                    mime="text/csv", key="dl_csv"
                )

            with col_md2:
                md_text_dl = "\n\n---\n\n".join([tc.to_markdown() for tc in md_cases])
                st.download_button(
                    label="Markdown", data=md_text_dl,
                    file_name=feature + "_" + ts + ".md",
                    mime="text/markdown", key="dl_md"
                )

            with col_new:
                if st.button("Новая генерация", key="btn_new_export"):
                    for key, val in defaults.items():
                        st.session_state[key] = val
                    st.rerun()

            st.markdown("---")
            with st.expander("Предпросмотр XML", expanded=True):
                st.code(xml_result[:8000], language="xml")

            if st.button("Переобвязать", key="btn_rewrap"):
                st.session_state.xml_result = None
                st.rerun()

with tab2:
    st.markdown("### База эталонов")

    col_add, _ = st.columns([1, 4])
    with col_add:
        btn_label = "Скрыть форму" if st.session_state.show_etalon_form else "+ Добавить эталон"
        if st.button(btn_label, key="toggle_etalon_form"):
            st.session_state.show_etalon_form = not st.session_state.show_etalon_form
            st.rerun()

    if st.session_state.show_etalon_form:
        st.markdown("---")
        st.markdown("#### Добавление эталона")

        etalon_mode = st.radio("Способ ввода:", ["Текст", "Файлы"], horizontal=True, key="etalon_mode_radio")

        etalon_req_text = ""
        etalon_tc_text = ""

        if etalon_mode == "Текст":
            col_req, col_tc = st.columns(2)
            with col_req:
                etalon_req_text = st.text_area("Требования *", height=200,
                    placeholder="Вставьте текст требований...", key="etalon_req_input")
            with col_tc:
                etalon_tc_text = st.text_area("Тест-кейсы (XML) *", height=200,
                    placeholder="Вставьте XML тест-кейсов...", key="etalon_tc_input")
        else:
            col_req_f, col_tc_f = st.columns(2)
            with col_req_f:
                etalon_req_file = st.file_uploader("Файл требований *",
                    type=["pdf", "docx", "txt", "xml"], key="etalon_req_file")
                if etalon_req_file:
                    try:
                        etalon_req_text = parse_file(etalon_req_file.read(), etalon_req_file.name)
                        st.success(str(len(etalon_req_text)) + " символов загружено")
                    except Exception as e:
                        st.error(str(e))
            with col_tc_f:
                etalon_tc_file = st.file_uploader("Файл тест-кейсов (XML) *",
                    type=["xml", "txt"], key="etalon_tc_file")
                if etalon_tc_file:
                    try:
                        etalon_tc_text = etalon_tc_file.read().decode("utf-8")
                        st.success(str(len(etalon_tc_text)) + " символов загружено")
                    except Exception as e:
                        st.error(str(e))

        col_et_plat, col_et_feat = st.columns(2)
        with col_et_plat:
            etalon_platform = st.selectbox("Платформа", ["W", "M", "A"], key="etalon_plat")
        with col_et_feat:
            etalon_feature = st.text_input("Фича", value="", key="etalon_feat")

        can_submit = bool(etalon_req_text and etalon_tc_text)
        if not can_submit:
            st.caption("Заполните оба поля для сохранения")

        if st.button("Сохранить эталон", disabled=not can_submit, key="save_etalon_btn", type="primary"):
            try:
                from vector_store import VectorStore
                vs = VectorStore()
                ts = datetime.now().strftime("%Y%m%d%H%M%S")
                req_id = "REQ-MANUAL-" + ts
                vs.add_requirement(req_id=req_id, text=etalon_req_text,
                    metadata={"platform": etalon_platform, "feature": etalon_feature, "source": "manual", "created": ts})
                pair_id = "PAIR-MANUAL-" + ts
                vs.add_pair(pair_id=pair_id, requirement_text=etalon_req_text, test_case_xml=etalon_tc_text,
                    metadata={"platform": etalon_platform, "feature": etalon_feature, "source": "manual", "created": ts})
                st.success("Эталон добавлен: " + req_id + " | " + pair_id)
                st.session_state.show_etalon_form = False
                st.balloons()
                st.rerun()
            except Exception as e:
                st.error("Ошибка: " + str(e))

    st.markdown("---")

    try:
        from vector_store import VectorStore
        vs = VectorStore()

        col_f1, col_f2, _ = st.columns([1, 1, 3])
        with col_f1:
            filter_platform = st.selectbox("Платформа", ["Все", "W", "M", "A"], key="et_filter_platform")
        with col_f2:
            filter_source = st.selectbox("Источник", ["Все", "user_approved", "manual"], key="et_filter_source")

        pairs_col = vs.pairs
        all_pairs = pairs_col.get(include=["metadatas", "documents"])

        if all_pairs and all_pairs["ids"]:
            shown = 0
            for i, pid in enumerate(all_pairs["ids"]):
                meta = all_pairs["metadatas"][i] if all_pairs["metadatas"] else {}
                doc = all_pairs["documents"][i] if all_pairs["documents"] else ""
                if filter_platform != "Все" and meta.get("platform", "") != filter_platform:
                    continue
                if filter_source != "Все" and meta.get("source", "") != filter_source:
                    continue
                shown += 1
                plat = meta.get("platform", "?")
                feat = meta.get("feature", "?")
                src = meta.get("source", "?")
                created = meta.get("created", "?")
                with st.expander(pid + " | " + plat + " | " + feat + " | " + src):
                    st.caption("Создан: " + created + " · Платформа: " + plat + " · Источник: " + src)
                    st.text(doc[:1000])
                    if st.button("Удалить", key="del_" + pid):
                        pairs_col.delete(ids=[pid])
                        st.success("Удалён: " + pid)
                        st.rerun()
            if shown == 0:
                st.info("Нет эталонов по выбранным фильтрам")
            else:
                st.caption("Показано: " + str(shown) + " из " + str(len(all_pairs["ids"])))
        else:
            st.info("Эталонов пока нет")
    except Exception as e:
        st.error("Ошибка загрузки: " + str(e))

with tab3:
    st.markdown("### Баг-репорт по описанию")
    st.caption("Опишите проблему своими словами — LLM оформит её в стандартный формат дефекта")

    col_plat, col_feat = st.columns([1, 2])
    with col_plat:
        bug_platform = st.selectbox(
            "Платформа", ["Front", "Back", "iOS", "Android"],
            key="bug_platform"
        )
    with col_feat:
        bug_feature = st.text_input("Наименование фичи", placeholder="Например: Дежурная смена", key="bug_feature")

    bug_description = st.text_area(
        "Описание проблемы",
        height=180,
        placeholder="Опишите что сломалось, где, при каких условиях, что делали...",
        key="bug_description"
    )

    col_btn, col_copy, _ = st.columns([1, 1, 3])
    with col_btn:
        btn_bug = st.button("Сформировать дефект", type="primary", key="btn_bug_generate")
    with col_copy:
        if st.session_state.bug_report_result:
            if st.button("Очистить", key="btn_bug_clear"):
                st.session_state.bug_report_result = None
                st.rerun()

    if btn_bug:
        if not bug_description.strip():
            st.warning("Опишите проблему")
        elif not bug_feature.strip():
            st.warning("Укажите наименование фичи")
        elif not selected_provider:
            st.error("Нет доступного LLM")
        else:
            now_str = datetime.now().strftime("%d.%m.%Y %H:%M")
            bug_prompt = f"""Ты ведущий QA-инженер. Твоя задача — оформить профессиональный баг-репорт строго по эталонному формату.

ВХОДНЫЕ ДАННЫЕ:
Платформа: {bug_platform}
Фича: {bug_feature}
Дата: {now_str}
Описание от разработчика/аналитика: {bug_description}

ПРАВИЛА ОФОРМЛЕНИЯ:
1. Название дефекта — конкретное, описывает симптом/поведение системы (НЕ "важность" или "проблема"), до 12 слов
2. Описание проблемы — технически точное, с контекстом: что, где, при каких условиях, какой компонент
3. Шаги воспроизведения — детальные, пронумерованные, воспроизводимые другим человеком (5-7 шагов)
4. Ожидаемый результат — конкретное корректное поведение системы
5. Фактический результат — точное описание аномалии (зависание, ошибка, пустой ответ и т.д.)
6. Между разделами — горизонтальный разделитель ---

ЭТАЛОННЫЙ ПРИМЕР ФОРМАТА (строго соблюдай):

**Название дефекта:** `[Back][GigaChat/SberSpace] SberSpace зависает при получении саммари инцидента длиной более 800 символов`

---

**Описание проблемы:**
При формировании саммари по инциденту GigaChat передаёт текст в SberSpace для получения инструкции. Если длина саммари превышает 800 символов, SberSpace зависает — не возвращает ответ, не отдаёт ошибку, соединение остаётся в ожидании до таймаута. Обработка корректно работает только при длине менее 800 символов.

---

**Шаги воспроизведения:**
1. Авторизоваться в системе
2. Открыть инцидент с объёмным описанием
3. Инициировать формирование саммари через GigaChat
4. GigaChat формирует саммари длиной более 800 символов и направляет в SberSpace
5. Наблюдать результат в интерфейсе и Network-вкладке DevTools

---

**Ожидаемый результат:**
SberSpace принимает саммари любой длины, корректно обрабатывает и возвращает инструкцию по инциденту.

---

**Фактический результат:**
При длине саммари более 800 символов SberSpace зависает — ответ не возвращается, инструкция не формируется. При длине менее 800 символов обработка проходит корректно.

---

Теперь оформи баг-репорт по описанию выше в точно таком же формате. Выведи ТОЛЬКО готовый баг-репорт, без пояснений."""

            with st.spinner("LLM формирует дефект..."):
                try:
                    llm = LLMClient(selected_provider)
                    msgs = [Message(role="user", content=bug_prompt)]
                    result = llm.chat(msgs)
                    st.session_state.bug_report_result = result.content if hasattr(result, "content") else str(result)
                    st.rerun()
                except Exception as e:
                    st.error("Ошибка LLM: " + str(e))

    if st.session_state.bug_report_result:
        st.markdown("---")
        st.markdown("#### Готовый дефект")
        result_text = st.session_state.bug_report_result
        st.markdown(result_text)
        st.markdown("---")
        st.download_button(
            label="Скачать (.md)",
            data=result_text,
            file_name="defect_" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".md",
            mime="text/markdown",
            key="dl_bug_report"
        )
        st.text_area("Копировать текст", value=result_text, height=300, key="bug_copy_area")


with tab4:
    st.markdown("### SimpleTest v2")
    st.markdown("""
**Архитектура:** 3-слойная генерация

| Слой | Что делает |
|------|-----------|
| 1 | QA документация |
| 2 | Список кейсов (JSON) |
| 3 | Markdown кейсы с шагами |

**Экспорт:** Zephyr XML / CSV / Markdown

**LLM:** GigaChat, DeepSeek, Ollama, LM Studio
    """)
    col_a, col_b = st.columns(2)
    with col_a:
        prov = selected_provider if selected_provider else "N/A"
        st.metric("LLM", prov)
    with col_b:
        fb = feedback.get_stats()
        st.metric("Оценок", fb["total"])
