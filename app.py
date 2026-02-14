"""
SimpleC — AI-powered QA Test Generator.
Neumorphism dark theme, restructured UI.
"""

import os
import sys
import time
import streamlit as st
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "db"))
sys.path.insert(0, str(ROOT / "agents"))

from test_generator import TestGeneratorAgent
from qa_doc_generator import QADocGenerator
from agents.llm_client import LLMClient, Message, LLMResponse
from agents.single_case_generator import SingleCaseGenerator
from file_parser import parse_file
from feedback_store import FeedbackStore
from secure_config import SecureConfig
from audit_log import AuditLog
from prompt_guard import sanitize_input
from team_store import TeamStore
from tc_formatter import (
    parse_test_cases_from_xml,
    split_xml_by_chunks,
    cases_to_csv,
)

st.set_page_config(
    page_title="SimpleC",
    page_icon="🧪",
    layout="wide",
    initial_sidebar_state="expanded"
)

# ─── Neumorphism CSS + Fixed Selectbox ───
st.markdown("""
<link href="https://unpkg.com/lucide-static@latest/font/lucide.css" rel="stylesheet">
<style>
    .stApp { background: #1a1d23 !important; }
    
    .neu-card {
        background: #1a1d23;
        border-radius: 20px;
        box-shadow: 4px 4px 8px #13151a, -4px -4px 8px #21252c;
        padding: 20px;
        margin: 10px 0;
    }
    
    .neu-card-inset {
        background: #1a1d23;
        border-radius: 16px;
        box-shadow: inset 2px 2px 4px #13151a, inset -2px -2px 4px #21252c;
        padding: 16px;
        margin: 8px 0;
    }
    
    .stButton > button {
        background: #1a1d23 !important;
        color: #00C9A7 !important;
        border: none !important;
        border-radius: 12px !important;
        font-weight: 600 !important;
        box-shadow: 3px 3px 6px #13151a, -3px -3px 6px #21252c !important;
        transition: all 0.2s ease !important;
        padding: 12px 24px !important;
    }
    
    .stButton > button:hover {
        box-shadow: 2px 2px 4px #13151a, -2px -2px 4px #21252c !important;
        color: #00E0BA !important;
    }
    
    .stButton > button:active {
        box-shadow: inset 2px 2px 4px #13151a, inset -2px -2px 4px #21252c !important;
    }
    
    .stDownloadButton > button {
        background: #1a1d23 !important;
        color: #00C9A7 !important;
        border: none !important;
        border-radius: 12px !important;
        font-weight: 600 !important;
        box-shadow: 3px 3px 6px #13151a, -3px -3px 6px #21252c !important;
    }
    
    .stDownloadButton > button:hover {
        box-shadow: 2px 2px 4px #13151a, -2px -2px 4px #21252c !important;
        color: #00E0BA !important;
    }
    
    .stTextInput > div > div > input,
    .stTextArea > div > div > textarea {
        background: #1a1d23 !important;
        border: none !important;
        border-radius: 12px !important;
        box-shadow: inset 2px 2px 4px #13151a, inset -2px -2px 4px #21252c !important;
        color: #E0E0E0 !important;
        padding: 12px !important;
    }
    
    /* FIXED: Selectbox styling - WHITE text */
    .stSelectbox > div > div {
        background: #1a1d23 !important;
        border: none !important;
        border-radius: 12px !important;
        box-shadow: inset 2px 2px 4px #13151a, inset -2px -2px 4px #21252c !important;
    }
    
    .stSelectbox [data-baseweb="select"] > div {
        background: transparent !important;
        border: none !important;
    }
    
    .stSelectbox [data-baseweb="select"] span,
    .stSelectbox [data-baseweb="select"] div {
        color: #FFFFFF !important;
    }
    
    .stSelectbox svg { fill: #00C9A7 !important; }
    
    [data-baseweb="popover"] {
        background: #1a1d23 !important;
        border: 1px solid #2A2D36 !important;
        border-radius: 12px !important;
        box-shadow: 4px 4px 8px #13151a, -4px -4px 8px #21252c !important;
    }
    
    [data-baseweb="menu"] { background: #1a1d23 !important; }
    
    [role="option"] {
        background: #1a1d23 !important;
        color: #C0C8D4 !important;
    }
    
    [role="option"]:hover {
        background: #21252c !important;
        color: #00C9A7 !important;
    }
    
    [aria-selected="true"] {
        background: #21252c !important;
        color: #00C9A7 !important;
    }
    
    .stMultiSelect [data-baseweb="tag"] {
        background: #21252c !important;
        color: #FFFFFF !important;
        border-radius: 8px !important;
    }
    
    .stMultiSelect span { color: #FFFFFF !important; }
    
    .stMultiSelect [data-baseweb="select"] span,
    .stMultiSelect [data-baseweb="select"] div {
        color: #FFFFFF !important;
    }
    
    .stFileUploader > div {
        background: #1a1d23 !important;
        border-radius: 16px !important;
        box-shadow: inset 2px 2px 4px #13151a, inset -2px -2px 4px #21252c !important;
        border: 2px dashed #2A2D36 !important;
    }
    
    .stFileUploader label { color: #8892A0 !important; }
    
    .stTabs [data-baseweb="tab-list"] {
        background: #1a1d23;
        border-radius: 16px;
        box-shadow: inset 2px 2px 4px #13151a, inset -2px -2px 4px #21252c;
        padding: 8px;
        gap: 8px;
    }
    
    .stTabs [data-baseweb="tab"] {
        background: transparent !important;
        border-radius: 12px !important;
        color: #8892A0 !important;
        font-weight: 500 !important;
    }
    
    .stTabs [aria-selected="true"] {
        background: #1a1d23 !important;
        box-shadow: 2px 2px 4px #13151a, -2px -2px 4px #21252c !important;
        color: #00C9A7 !important;
    }
    
    [data-testid="stMetricValue"] { color: #00C9A7 !important; font-weight: 700 !important; }
    [data-testid="stMetricLabel"] { color: #8892A0 !important; }
    [data-testid="stMetricDelta"] { color: #00C9A7 !important; }
    
    [data-testid="stSidebar"], [data-testid="stSidebar"] > div { background: #1a1d23 !important; }
    
    .streamlit-expanderHeader {
        background: #1a1d23 !important;
        border-radius: 12px !important;
        color: #C0C8D4 !important;
    }
    
    .streamlit-expanderContent {
        background: #1a1d23 !important;
        border: 1px solid #2A2D36 !important;
        border-radius: 0 0 12px 12px !important;
    }
    
    .stTable { background: #1a1d23 !important; border-radius: 12px !important; overflow: hidden !important; }
    .stTable thead tr th { background: #21252c !important; color: #00C9A7 !important; border-color: #2A2D36 !important; }
    .stTable tbody tr td { background: #1a1d23 !important; color: #C0C8D4 !important; border-color: #2A2D36 !important; }
    
    .stProgress > div > div { background: linear-gradient(90deg, #00C9A7, #00B896) !important; border-radius: 8px !important; }
    
    .stRadio label { color: #C0C8D4 !important; }
    .stRadio [data-baseweb="radio"] { background: #1a1d23 !important; }
    .stCheckbox label span { color: #C0C8D4 !important; }
    
    .stSelectbox label, .stTextInput label, .stTextArea label, .stMultiSelect label { color: #8892A0 !important; }
    .stCaption { color: #6B7280 !important; }
    .stCodeBlock { background: #13151a !important; border-radius: 12px !important; }
    
    .stSuccess { background: rgba(0, 201, 167, 0.1) !important; border: 1px solid #00C9A7 !important; border-radius: 12px !important; }
    .stWarning { background: rgba(255, 193, 7, 0.1) !important; border: 1px solid #FFC107 !important; border-radius: 12px !important; }
    .stError { background: rgba(239, 68, 68, 0.1) !important; border: 1px solid #EF4444 !important; border-radius: 12px !important; }
    .stInfo { background: rgba(0, 201, 167, 0.05) !important; border: 1px solid #2A2D36 !important; border-radius: 12px !important; color: #8892A0 !important; }
    
    .llm-status-bar { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .llm-dot { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #8892A0; }
    .llm-dot .dot { width: 8px; height: 8px; border-radius: 50%; }
    .llm-dot .dot.ready { background: #00C9A7; box-shadow: 0 0 8px #00C9A7; }
    .llm-dot .dot.off { background: #4A4A4A; }
    
    .logo-container {
        display: flex; align-items: center; gap: 16px; padding: 20px; margin-bottom: 16px;
        background: #1a1d23; border-radius: 20px;
        box-shadow: 4px 4px 8px #13151a, -4px -4px 8px #21252c;
    }
    
    .logo-icon {
        width: 56px; height: 56px;
        background: linear-gradient(135deg, #00C9A7, #00B896);
        border-radius: 16px;
        display: flex; align-items: center; justify-content: center;
        font-size: 28px; color: #1a1d23; font-weight: bold;
        box-shadow: 2px 2px 4px #13151a, -2px -2px 4px #21252c;
    }
    
    .section-header {
        color: #00C9A7; font-size: 12px; font-weight: 600;
        text-transform: uppercase; letter-spacing: 1px;
        margin: 20px 0 12px 0; padding-bottom: 8px;
        border-bottom: 1px solid #2A2D36;
        display: flex; align-items: center; gap: 8px;
    }
    
    .neu-metric {
        background: #1a1d23; border-radius: 16px;
        box-shadow: 3px 3px 6px #13151a, -3px -3px 6px #21252c;
        padding: 16px; text-align: center;
    }
    
    .neu-metric-value { font-size: 32px; font-weight: 700; color: #00C9A7; }
    .neu-metric-label { font-size: 12px; color: #8892A0; margin-top: 4px; }
    
    h1, h2, h3, h4 { color: #E0E0E0 !important; }
    /* Custom SVG Icons - Teal color */
    .icon-doc::before { content: ""; display: inline-block; width: 16px; height: 16px; margin-right: 6px; background: #00C9A7; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/%3E%3Cpolyline points='14 2 14 8 20 8'/%3E%3C/svg%3E") center/contain no-repeat; -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/%3E%3Cpolyline points='14 2 14 8 20 8'/%3E%3C/svg%3E") center/contain no-repeat; }

</style>
""", unsafe_allow_html=True)

# ─── Security ───
env_issues = SecureConfig.validate_env()
for issue in env_issues:
    if "CRITICAL" in issue:
        st.error("🔒 " + issue)
    else:
        st.warning("" + issue)

# ─── Init ───
@st.cache_resource
def init_agent():
    return TestGeneratorAgent()

@st.cache_resource
def init_qa_doc():
    return QADocGenerator()

@st.cache_resource
def init_feedback():
    return FeedbackStore()

agent = init_agent()
qa_doc = init_qa_doc()
feedback = init_feedback()
stats = agent.get_stats()
fb_stats = feedback.get_stats()

AC_LIST = [
    "РМДС [CI04663743]",
    "ППРБ [CI04663744]",
    "СББОЛ [CI04663745]",
    "Omega [CI04663746]",
    "Сигма [CI04663747]",
]

DEPTH_OPTIONS = {
    "Smoke (1-5 кейсов)": {"min": 1, "max": 5, "label": "smoke"},
    "Общие (5-15 кейсов)": {"min": 5, "max": 15, "label": "general"},
    "Детальные (15-30 кейсов)": {"min": 15, "max": 30, "label": "detailed"},
    "Атомарные (30-50 кейсов)": {"min": 30, "max": 50, "label": "atomic"},
}

defaults = {
    "generated": False,
    "tc_result": None,
    "qa_doc_result": None,
    "requirement_text": "",
    "feature_name_generated": "",
    "fb_tc_given": False,
    "fb_tc_positive": False,
    "fb_qa_given": False,
    "fb_qa_positive": False,
    "etalon_added": False,
    "show_etalon_form": False,
    "etalon_input_mode": "text",
}
for key, val in defaults.items():
    if key not in st.session_state:
        st.session_state[key] = val

# ─── Sidebar ───
with st.sidebar:
    providers = LLMClient.get_available_providers()
    status_html = '<div class="llm-status-bar">'
    for p in providers:
        dot_class = "ready" if p["status"] == "ready" else "off"
        name_short = p["id"][:4].upper()
        status_html += f'<span class="llm-dot"><span class="dot {dot_class}"></span>{name_short}</span>'
    status_html += '</div>'
    st.markdown(status_html, unsafe_allow_html=True)
    
    st.markdown("""
    <div class="logo-container">
        <div class="logo-icon">SC</div>
        <div>
            <div style="font-size: 24px; font-weight: 700; color: #E0E0E0;">SimpleC</div>
            <div style="font-size: 12px; color: #8892A0;">AI Test Generator</div>
        </div>
    </div>
    """, unsafe_allow_html=True)
    
    ready_providers = [p for p in providers if p["status"] == "ready"]
    if ready_providers:
        provider_names = {p["id"]: p["name"] for p in providers}
        selected_provider = st.selectbox(
            "Модель",
            options=[p["id"] for p in ready_providers],
            format_func=lambda x: provider_names.get(x, x),
            key="llm_provider"
        )
        st.session_state["selected_provider"] = selected_provider
    else:
        st.markdown('<span class="llm-dot"><span class="dot off"></span>Нет LLM</span>', unsafe_allow_html=True)
        st.session_state["selected_provider"] = None
    
    depth_choice = st.selectbox("Глубина тестирования", options=list(DEPTH_OPTIONS.keys()), index=1)
    depth = DEPTH_OPTIONS[depth_choice]
    
    st.markdown('<div class="section-header">Настройки проекта</div>', unsafe_allow_html=True)
    
    col_plat = st.columns(2)
    with col_plat[0]:
        platform = st.selectbox("Платформа", ["M", "W", "A"], index=0)
    with col_plat[1]:
        feature = st.text_input("Код фичи", value="INCIDENT")
    
    team_list = TeamStore.get_display_list()
    team = st.selectbox("Команда", options=team_list, index=0)
    system = st.selectbox("АС", options=AC_LIST, index=0)
    domain = st.multiselect("Домен", options=["Omega", "Sigma", "Mobile"], default=["Omega"])
    
    st.markdown('<div class="section-header">База эталонов</div>', unsafe_allow_html=True)
    col_st1, col_st2, col_st3 = st.columns(3)
    col_st1.metric("Треб.", stats["db"]["requirements"])
    col_st2.metric("ТК", stats["db"]["test_cases"])
    col_st3.metric("Пары", stats["db"]["pairs"])
    
    st.markdown('<div class="section-header">Качество</div>', unsafe_allow_html=True)
    if fb_stats["total"] > 0:
        col_q1, col_q2 = st.columns(2)
        col_q1.metric("Оценок", fb_stats["total"], delta=str(fb_stats["approval_rate"]) + "% ok")
        col_q2.metric("Результат", str(fb_stats["positive"]) + " / " + str(fb_stats["negative"]))
    else:
        st.caption("Оценок пока нет")
    
    st.markdown("---")
    st.caption("🔒 SSL ✅ | Guard ✅ | Audit ✅")

domain_str = ", ".join(domain) if domain else "Omega"

# ─── Tabs ───
generated = st.session_state.generated

tab1, tab2, tab3, tab4 = st.tabs(["Требования", "Тест-кейсы", "Эталоны", "О системе"])

# ═══════════════════════════════════════════
# TAB 1 — Требования
# ═══════════════════════════════════════════
with tab1:
    st.markdown("### Загрузка требований")
    
    requirement = ""
    use_text = st.toggle("Ввести текст вручную", value=False)

    if use_text:
        requirement = st.text_area("Введите требование:", height=200, placeholder="Вставьте текст требования...")
    else:
        uploaded_files = st.file_uploader(
            "Загрузите файлы с требованиями:",
            type=["pdf", "docx", "doc", "xlsx", "xls", "xml", "png", "jpg", "jpeg", "txt"],
            accept_multiple_files=True
        )
        if uploaded_files:
            all_texts = []
            for uf in uploaded_files:
                with st.spinner("Обработка " + uf.name + "..."):
                    try:
                        text = parse_file(uf.read(), uf.name)
                        all_texts.append("=== " + uf.name + " ===\n" + text)
                        AuditLog.log_file_upload(uf.name, uf.size, success=True)
                        with st.expander("✓ " + uf.name + " (" + str(len(text)) + " сим.)"):
                            st.text(text[:2000])
                    except ValueError as e:
                        AuditLog.log_file_upload(uf.name, uf.size, success=False)
                        st.error("✗ " + uf.name + ": " + str(e))
            if all_texts:
                requirement = "\n\n".join(all_texts)
                st.success("Загружено: " + str(len(all_texts)) + " | " + str(len(requirement)) + " символов")

    st.markdown("---")
    col_gen, _ = st.columns([1, 4])
    with col_gen:
        btn_generate = st.button("Генерировать", type="primary")

    if btn_generate and requirement:
        if not st.session_state.get("selected_provider"):
            st.error("🔴 Нет доступных LLM провайдеров.")
        else:
            check = sanitize_input(requirement)
            if check["warnings"]:
                for w in check["warnings"]:
                    st.warning("" + w)
                AuditLog.log_security_event("prompt_warning", str(check["warnings"]))

            # Определяем тип требования
            from agents.prompt_templates import PromptTemplateManager
            req_types = PromptTemplateManager.detect_type(check["text"])
            type_names = PromptTemplateManager.get_template_names()
            detected_names = [type_names.get(t, t) for t in req_types]
            st.info("🎯 Тип требования: " + ", ".join(detected_names))
            
            start_time = time.time()
            progress = st.progress(0, text="Генерирую тест-кейсы...")
            
            # Кнопка остановки
            stop_col1, stop_col2 = st.columns([3, 1])
            with stop_col2:
                stop_button = st.button("⏹️ Остановить", key="stop_generation", type="secondary")
                if stop_button:
                    st.session_state["stop_requested"] = True
            
            # Контейнер для статуса
            status_container = st.empty()

            # Надёжная генерация по одному кейсу с учётом глубины
            selected_provider = st.session_state.get("selected_provider", "ollama")
            llm_client = LLMClient(selected_provider)
            single_gen = SingleCaseGenerator(llm_client)
            
            # depth["max"] содержит количество кейсов (3, 5, 7, 10)
            target_count = depth["max"]
            
            def update_progress(current, total, name):
                progress.progress(current / total if total > 0 else 0, text=f"Генерирую {current}/{total}: {name}")
            
            # ШАГ 1: Сначала генерируем QA документ
            progress.progress(10, text="Генерирую QA документацию...")
            qa_result = qa_doc.generate(requirement=check["text"], feature_name=feature)
            
            # ШАГ 2: Генерируем кейсы на основе QA документа
            cases = []
            case_types = single_gen.CASE_TYPES[:target_count]
            st.session_state["stop_requested"] = False
            stopped_early = False
            
            # Используем QA док как основу для генерации кейсов
            enriched_requirement = f"{check['text']}\n\nQA ДОКУМЕНТАЦИЯ:\n{qa_result}"
            
            for i, case_type in enumerate(case_types):
                if st.session_state.get("stop_requested", False):
                    stopped_early = True
                    break
                
                pct = 10 + int(80 * (i + 1) / target_count)
                progress.progress(pct, text=f"Генерирую {i+1}/{target_count}: {case_type['name']}")
                
                case_xml = single_gen.generate_single(
                    requirement=enriched_requirement,
                    case_type=case_type,
                    platform=platform,
                    feature=feature,
                    domain=domain_str,
                    team=team,
                    system=system,
                    folder="Новая ТМ"
                )
                
                if case_xml:
                    cases.append(case_xml)
            
            if stopped_early:
                progress.progress(100, text=f"Остановлено. Сгенерировано {len(cases)} из {target_count}")
            
            if not cases:
                st.error("Не удалось сгенерировать ни одного кейса")
                st.stop()
            
            xml_files = SingleCaseGenerator.bundle_to_files(cases, cases_per_file=10)
            tc_result = xml_files[0] if xml_files else "<testCases></testCases>"
            st.session_state["generated_files"] = xml_files
            st.session_state["generated_cases_count"] = len(cases)
            progress.progress(100, text="Готово!")

            duration = time.time() - start_time
            # tc_result теперь строка XML
            cases_count = st.session_state.get("generated_cases_count", tc_result.count("<testCase>"))
            AuditLog.log_generation(
                gen_type="test_cases", platform=platform, feature=feature,
                input_size=len(requirement), output_size=len(tc_result),
                etalons_used=0,
                test_cases_count=cases_count,
                duration_sec=duration, success=True,
                error="",
            )

            st.session_state.tc_result = {"xml": tc_result, "test_cases_count": cases_count}
            st.session_state.qa_doc_result = qa_result
            st.session_state.requirement_text = requirement
            st.session_state.feature_name_generated = qa_result.get("feature_name", "Фича")
            st.session_state.generated = True
            st.session_state.fb_tc_given = False
            st.session_state.fb_tc_positive = False
            st.session_state.fb_qa_given = False
            st.session_state.fb_qa_positive = False
            st.session_state.etalon_added = False
            st.rerun()

    if btn_generate and not requirement:
        st.warning(" Загрузите файл или введите текст")

    if st.session_state.generated and st.session_state.qa_doc_result:
        qa_result = st.session_state.qa_doc_result
        if not qa_result.get("error"):
            st.markdown("---")
            st.markdown("### " + qa_result.get("feature_name", "Описание фичи"))
            
            col_s1, col_s2, col_s3 = st.columns(3)
            col_s1.metric("Разделов", qa_result.get("sections", 0))
            col_s2.metric("Чек-лист", qa_result.get("checklist_items", 0))
            col_s3.metric("Символов", len(qa_result.get("doc", "")))

            st.markdown("---")
            st.code(qa_result.get("doc", ""), language="markdown")

            st.markdown("---")
            ts_dl = datetime.now().strftime("%Y%m%d_%H%M%S")
            st.download_button(
                label="Скачать .md", data=qa_result.get("doc", ""),
                file_name="qa_doc_" + ts_dl + ".md", mime="text/markdown", key="dl_qa"
            )

            st.markdown("---")
            st.markdown("### Оцените результат")

            if st.session_state.fb_qa_given:
                st.success("✓ Оценка принята")
            else:
                col_up2, col_down2, _ = st.columns([1, 1, 3])
                with col_up2:
                    if st.button("Принять", key="qa_up"):
                        feedback.add_feedback(
                            generation_type="qa_doc", rating="positive",
                            requirement_preview=st.session_state.requirement_text[:500],
                            result_preview=qa_result.get("doc", "")[:500],
                            platform=platform, feature=feature,
                            sections_count=qa_result.get("sections", 0),
                        )
                        AuditLog.log_feedback("qa_doc", "positive")
                        st.session_state.fb_qa_given = True
                        st.session_state.fb_qa_positive = True
                        st.rerun()
                with col_down2:
                    if st.button("Отклонить", key="qa_down"):
                        st.session_state.show_qa_comment = True

                if st.session_state.get("show_qa_comment"):
                    qa_comment = st.text_area("Что не так?", placeholder="Опишите проблему...", key="qa_comment_input")
                    if st.button("Отправить", key="qa_send"):
                        feedback.add_feedback(
                            generation_type="qa_doc", rating="negative",
                            requirement_preview=st.session_state.requirement_text[:500],
                            result_preview=qa_result.get("doc", "")[:500],
                            comment=qa_comment, platform=platform, feature=feature,
                            sections_count=qa_result.get("sections", 0),
                        )
                        AuditLog.log_feedback("qa_doc", "negative", qa_comment)
                        st.session_state.fb_qa_given = True
                        st.session_state.fb_qa_positive = False
                        st.session_state.show_qa_comment = False
                        st.rerun()

    if st.session_state.generated:
        st.markdown("---")
        if st.button("Новая генерация", key="new_gen_tab1"):
            for key, val in defaults.items():
                st.session_state[key] = val
            st.rerun()

# ═══════════════════════════════════════════
# TAB 2 — Тест-кейсы
# ═══════════════════════════════════════════
with tab2:
    if not st.session_state.generated:
        st.markdown("### Тест-кейсы")
        st.info("Сначала загрузите требования и нажмите «Генерировать» на вкладке «Требования»")
    else:
        result = st.session_state.tc_result
        if result and result.get("error"):
            st.error("✗ " + result["error"])
        elif result:
            xml_text = result.get("xml", "")
            cases = parse_test_cases_from_xml(xml_text)
            fname = st.session_state.feature_name_generated or feature

            st.success("✓ Тест-кейсов: " + str(len(cases)) + " | Глубина: " + depth["label"])

            with st.expander("Debug XML"):
                st.code(xml_text[:3000], language="xml")

            with st.expander("Debug Parsed"):
                st.write(f"Cases count: {len(cases)}")
                if cases:
                    st.write(f"First case steps: {len(cases[0].get('steps', []))}")
                    if cases[0].get("steps"):
                        st.json(cases[0]["steps"][0])

            if cases:
                for idx, tc in enumerate(cases, 1):
                    tc_name = tc["name"].replace("<![CDATA[", "").replace("]]>", "")
                    st.markdown(f"#### {idx}. {tc_name}")
                    if tc["steps"]:
                        table_data = []
                        for s in tc["steps"]:
                            table_data.append({
                                "Действие": s["action"],
                                "Тестовые данные": s["test_data"],
                                "Ожидаемый результат": s["expected"],
                            })
                        st.table(table_data)
                    else:
                        st.caption("Шаги не распознаны")
                    st.markdown("")
            else:
                st.warning("Не удалось распарсить кейсы")
                st.code(xml_text[:2000], language="xml")

            st.markdown("---")
            chunks = split_xml_by_chunks(xml_text, fname, 10)
            csv_data = cases_to_csv(cases)

            col_dl1, col_dl2, _ = st.columns([1, 1, 3])
            with col_dl1:
                if len(chunks) == 1:
                    st.download_button(label="Скачать XML", data=chunks[0]["xml"],
                        file_name=chunks[0]["filename"], mime="application/xml", key="dl_xml")
                else:
                    for i, ch in enumerate(chunks):
                        st.download_button(label=ch["filename"], data=ch["xml"],
                            file_name=ch["filename"], mime="application/xml", key="dl_xml_" + str(i))
            with col_dl2:
                st.download_button(label="Скачать CSV", data=csv_data,
                    file_name=fname + ".csv", mime="text/csv", key="dl_csv")

            st.markdown("---")
            st.markdown("### Оцените результат")

            if st.session_state.fb_tc_given:
                st.success("✓ Оценка принята")
            else:
                col_up, col_down, _ = st.columns([1, 1, 3])
                with col_up:
                    if st.button("Принять", key="tc_up"):
                        feedback.add_feedback(
                            generation_type="test_cases", rating="positive",
                            requirement_preview=st.session_state.requirement_text[:500],
                            result_preview=xml_text[:500], platform=platform, feature=feature,
                            etalons_used=result.get("etalons_used", 0), test_cases_count=len(cases),
                        )
                        AuditLog.log_feedback("test_cases", "positive")
                        st.session_state.fb_tc_given = True
                        st.session_state.fb_tc_positive = True
                        st.rerun()
                with col_down:
                    if st.button("Отклонить", key="tc_down"):
                        st.session_state.show_tc_comment = True

                if st.session_state.get("show_tc_comment"):
                    tc_comment = st.text_area("Что не так?", placeholder="Опишите проблему...", key="tc_comment_input")
                    if st.button("Отправить", key="tc_send"):
                        feedback.add_feedback(
                            generation_type="test_cases", rating="negative",
                            requirement_preview=st.session_state.requirement_text[:500],
                            result_preview=xml_text[:500], comment=tc_comment,
                            platform=platform, feature=feature,
                            etalons_used=result.get("etalons_used", 0), test_cases_count=len(cases),
                        )
                        AuditLog.log_feedback("test_cases", "negative", tc_comment)
                        st.session_state.fb_tc_given = True
                        st.session_state.fb_tc_positive = False
                        st.session_state.show_tc_comment = False
                        st.rerun()

            if (st.session_state.fb_tc_given and st.session_state.get("fb_tc_positive") and st.session_state.fb_qa_given and st.session_state.get("fb_qa_positive") and not st.session_state.etalon_added):
                st.markdown("---")
                st.markdown("""
                <div class="neu-card" style="text-align: center;">
                    <h3 style="color:#00C9A7; margin:0;">🏆 Обе оценки положительные!</h3>
                    <p style="color:#C0C8D4;">Добавить результаты как эталон в базу?</p>
                </div>
                """, unsafe_allow_html=True)
                
                col_et1, col_et2, _ = st.columns([1, 1, 3])
                with col_et1:
                    if st.button("Добавить", key="add_etalon"):
                        try:
                            from vector_store import VectorStore
                            vs = VectorStore()
                            ts2 = datetime.now().strftime("%Y%m%d%H%M%S")
                            req_text = st.session_state.requirement_text
                            tc_xml = st.session_state.tc_result.get("xml", "")
                            req_id = "REQ-USER-" + ts2
                            vs.add_requirement(
                                req_id=req_id, text=req_text,
                                metadata={"platform": platform, "feature": feature,
                                    "source": "user_approved", "created": ts2, "depth": depth["label"]}
                            )
                            pair_id = ""
                            if tc_xml:
                                pair_id = "PAIR-USER-" + ts2
                                vs.add_pair(
                                    pair_id=pair_id, requirement_text=req_text, test_case_xml=tc_xml,
                                    metadata={"platform": platform, "feature": feature,
                                        "source": "user_approved", "created": ts2, "depth": depth["label"]}
                                )
                            AuditLog.log_db_enrichment(req_id, pair_id)
                            st.session_state.etalon_added = True
                            st.success("✓ Эталон добавлен! " + req_id + " | " + pair_id)
                            st.balloons()
                            st.rerun()
                        except Exception as e:
                            st.error("✗ " + str(e))
                with col_et2:
                    if st.button("Пропустить", key="skip_etalon"):
                        st.session_state.etalon_added = True
                        st.rerun()

        if st.session_state.generated:
            st.markdown("---")
            if st.button("Новая генерация", key="new_gen_tab2"):
                for key, val in defaults.items():
                    st.session_state[key] = val
                st.rerun()

# ═══════════════════════════════════════════
# TAB 3 — Эталоны
# ═══════════════════════════════════════════
with tab3:
    st.markdown("### База эталонов")
    
    col_add, _ = st.columns([1, 4])
    with col_add:
        if st.button("+ Загрузить эталон"):
            st.session_state.show_etalon_form = not st.session_state.show_etalon_form
    
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
                        st.success(f"✅ {len(etalon_req_text)} символов")
                    except Exception as e:
                        st.error(f"❌ {e}")
            
            with col_tc_f:
                etalon_tc_file = st.file_uploader("Файл тест-кейсов (XML) *",
                    type=["xml", "txt"], key="etalon_tc_file")
                if etalon_tc_file:
                    try:
                        etalon_tc_text = etalon_tc_file.read().decode("utf-8")
                        st.success(f"✅ {len(etalon_tc_text)} символов")
                    except Exception as e:
                        st.error(f"❌ {e}")
        
        col_et_plat, col_et_feat = st.columns(2)
        with col_et_plat:
            etalon_platform = st.selectbox("Платформа", ["M", "W", "A"], key="etalon_plat")
        with col_et_feat:
            etalon_feature = st.text_input("Фича", value="", key="etalon_feat")
        
        can_submit = bool(etalon_req_text and etalon_tc_text)
        
        if st.button("Сохранить", disabled=not can_submit, key="save_etalon_btn"):
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
                
                AuditLog.log_db_enrichment(req_id, pair_id)
                st.success(f"✅ Эталон добавлен: {req_id} | {pair_id}")
                st.session_state.show_etalon_form = False
                st.balloons()
                st.rerun()
            except Exception as e:
                st.error(f"❌ Ошибка: {e}")
        
        if not can_submit:
            st.caption("⚠️ Заполните оба поля для сохранения")
    
    st.markdown("---")
    
    try:
        from vector_store import VectorStore
        vs = VectorStore()

        col_f1, col_f2, _ = st.columns([1, 1, 3])
        with col_f1:
            filter_platform = st.selectbox("Фильтр: Платформа", ["Все", "W", "M", "A"], key="et_platform")
        with col_f2:
            filter_source = st.selectbox("Фильтр: Источник", ["Все", "user_approved", "manual"], key="et_source")

        st.markdown("---")

        pairs_col = vs.pairs
        all_pairs = pairs_col.get(include=["metadatas", "documents"])

        if all_pairs and all_pairs["ids"]:
            st.markdown("**Всего пар:** " + str(len(all_pairs["ids"])))

            for i, pid in enumerate(all_pairs["ids"]):
                meta = all_pairs["metadatas"][i] if all_pairs["metadatas"] else {}
                doc = all_pairs["documents"][i] if all_pairs["documents"] else ""

                if filter_platform != "Все" and meta.get("platform", "") != filter_platform:
                    continue
                if filter_source != "Все" and meta.get("source", "") != filter_source:
                    continue

                plat = meta.get("platform", "?")
                feat = meta.get("feature", "?")
                src = meta.get("source", "?")
                created = meta.get("created", "?")

                with st.expander(pid + " | " + plat + " | " + feat + " | " + src):
                    st.markdown("**Создан:** " + created)
                    st.markdown("**Платформа:** " + plat)
                    st.markdown("**Фича:** " + feat)
                    st.markdown("**Источник:** " + src)
                    st.text(doc[:1000])

                    if st.button("Удалить", key="del_" + pid):
                        pairs_col.delete(ids=[pid])
                        AuditLog.log_security_event("etalon_deleted", pid)
                        st.success("Удалён: " + pid)
                        st.rerun()
        else:
            st.info("Эталонов пока нет")

    except Exception as e:
        st.error("Ошибка загрузки: " + str(e))

# ─────────────────────────────────────────────────────────────
# TAB 4: О СИСТЕМЕ
# ─────────────────────────────────────────────────────────────
with tab4:
    st.header("О системе")
    
    st.markdown("""
### 🧪 SimpleC — Генератор тест-кейсов

**Версия:** 1.0.0

**Описание:**  
Система автоматической генерации тест-кейсов на основе требований 
с использованием LLM и RAG (Retrieval-Augmented Generation).

---

### 🔧 Компоненты системы

| Компонент | Технология |
|-----------|------------|
| UI | Streamlit |
| LLM | GigaChat / DeepSeek / Ollama |
| Векторная БД | ChromaDB |
| Эмбеддинги | sentence-transformers |
    """)
    
    st.markdown("---")
    st.subheader("📊 Статистика")
    
    col1, col2, col3 = st.columns(3)
    
    try:
        from vector_store import VectorStore
        vs_info = VectorStore()
        pairs_count = len(vs_info.pairs.get()["ids"]) if vs_info.pairs.get()["ids"] else 0
    except:
        pairs_count = 0
    
    with col1:
        st.metric("Эталонов в базе", pairs_count)
    
    with col2:
        provider = st.session_state.get("selected_provider", "Не выбран")
        st.metric("Текущий LLM", provider)
    
    with col3:
        db_path = "db/chroma_store"
        if os.path.exists(db_path):
            size_mb = sum(os.path.getsize(os.path.join(dp, f)) for dp, dn, fn in os.walk(db_path) for f in fn) / (1024*1024)
            st.metric("Размер БД", f"{size_mb:.1f} MB")
        else:
            st.metric("Размер БД", "N/A")
