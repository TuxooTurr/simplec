"""
SimpleC v2 - AI-powered QA Test Generator.
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

from agents.llm_client import LLMClient, Message
from agents.layered_generator import LayeredGenerator, TestCaseMarkdown
from agents.prompt_templates import PromptTemplateManager
from file_parser import parse_file
from feedback_store import FeedbackStore
from secure_config import SecureConfig
from audit_log import AuditLog
from prompt_guard import sanitize_input
from team_store import TeamStore
from tc_formatter import parse_test_cases_from_xml, cases_to_csv

st.set_page_config(page_title="SimpleC", page_icon="\U0001f9ea", layout="wide", initial_sidebar_state="expanded")

st.markdown("""
<style>
    .stApp { background: #1a1d23 !important; }
    .neu-card {
        background: #1a1d23; border-radius: 20px;
        box-shadow: 4px 4px 8px #13151a, -4px -4px 8px #21252c;
        padding: 20px; margin: 10px 0;
    }
    .stButton > button {
        background: #1a1d23 !important; color: #00C9A7 !important;
        border: none !important; border-radius: 12px !important;
        font-weight: 600 !important;
        box-shadow: 3px 3px 6px #13151a, -3px -3px 6px #21252c !important;
        padding: 12px 24px !important;
    }
    .stButton > button:hover {
        box-shadow: 2px 2px 4px #13151a, -2px -2px 4px #21252c !important;
        color: #00E0BA !important;
    }
    .stDownloadButton > button {
        background: #1a1d23 !important; color: #00C9A7 !important;
        border: none !important; border-radius: 12px !important;
        font-weight: 600 !important;
        box-shadow: 3px 3px 6px #13151a, -3px -3px 6px #21252c !important;
    }
    .stTextInput > div > div > input,
    .stTextArea > div > div > textarea {
        background: #1a1d23 !important; border: none !important;
        border-radius: 12px !important;
        box-shadow: inset 2px 2px 4px #13151a, inset -2px -2px 4px #21252c !important;
        color: #E0E0E0 !important;
    }
    .stSelectbox > div > div {
        background: #1a1d23 !important; border: none !important;
        border-radius: 12px !important;
        box-shadow: inset 2px 2px 4px #13151a, inset -2px -2px 4px #21252c !important;
    }
    .stSelectbox [data-baseweb="select"] span,
    .stSelectbox [data-baseweb="select"] div { color: #FFFFFF !important; }
    .stSelectbox svg { fill: #00C9A7 !important; }
    [data-baseweb="popover"] { background: #1a1d23 !important; border: 1px solid #2A2D36 !important; }
    [data-baseweb="menu"] { background: #1a1d23 !important; }
    [role="option"] { background: #1a1d23 !important; color: #C0C8D4 !important; }
    [role="option"]:hover { background: #21252c !important; color: #00C9A7 !important; }
    [aria-selected="true"] { background: #21252c !important; color: #00C9A7 !important; }
    .stMultiSelect [data-baseweb="tag"] { background: #21252c !important; color: #FFFFFF !important; }
    .stMultiSelect span { color: #FFFFFF !important; }
    .stFileUploader > div {
        background: #1a1d23 !important; border-radius: 16px !important;
        box-shadow: inset 2px 2px 4px #13151a, inset -2px -2px 4px #21252c !important;
        border: 2px dashed #2A2D36 !important;
    }
    .stTabs [data-baseweb="tab-list"] {
        background: #1a1d23; border-radius: 16px;
        box-shadow: inset 2px 2px 4px #13151a, inset -2px -2px 4px #21252c;
        padding: 8px; gap: 8px;
    }
    .stTabs [data-baseweb="tab"] {
        background: transparent !important; border-radius: 12px !important; color: #8892A0 !important;
    }
    .stTabs [aria-selected="true"] {
        background: #1a1d23 !important;
        box-shadow: 2px 2px 4px #13151a, -2px -2px 4px #21252c !important;
        color: #00C9A7 !important;
    }
    [data-testid="stMetricValue"] { color: #00C9A7 !important; }
    [data-testid="stMetricLabel"] { color: #8892A0 !important; }
    [data-testid="stSidebar"], [data-testid="stSidebar"] > div { background: #1a1d23 !important; }
    .stSelectbox label, .stTextInput label, .stTextArea label, .stMultiSelect label { color: #8892A0 !important; }
    h1, h2, h3, h4 { color: #E0E0E0 !important; }
    .logo-container {
        display: flex; align-items: center; gap: 16px; padding: 20px; margin-bottom: 16px;
        background: #1a1d23; border-radius: 20px;
        box-shadow: 4px 4px 8px #13151a, -4px -4px 8px #21252c;
    }
    .logo-icon {
        width: 56px; height: 56px;
        background: linear-gradient(135deg, #00C9A7, #00B896);
        border-radius: 16px; display: flex; align-items: center; justify-content: center;
        font-size: 28px; color: #1a1d23; font-weight: bold;
    }
    .section-header {
        color: #00C9A7; font-size: 12px; font-weight: 600;
        text-transform: uppercase; letter-spacing: 1px;
        margin: 20px 0 12px 0; padding-bottom: 8px;
        border-bottom: 1px solid #2A2D36;
    }
    .llm-status-bar { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .llm-dot { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #8892A0; }
    .llm-dot .dot { width: 8px; height: 8px; border-radius: 50%; }
    .llm-dot .dot.green { background: #00C9A7; box-shadow: 0 0 8px #00C9A7; }
    .llm-dot .dot.yellow { background: #FFD93D; box-shadow: 0 0 8px #FFD93D; }
    .llm-dot .dot.red { background: #FF6B6B; box-shadow: 0 0 8px #FF6B6B; }
    .llm-dot .dot.off { background: #4A4A4A; }
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
}
for key, val in defaults.items():
    if key not in st.session_state:
        st.session_state[key] = val

with st.sidebar:
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
                results[p["id"]] = {"status": "red", "message": "Нет ключа / не запущен"}
        return results

    health = _ping_providers()

    status_html = '<div class="llm-status-bar">'
    for p in providers:
        hc = health.get(p["id"], {"status": "red", "message": "?"})
        dot_class = hc["status"]  # green / yellow / red
        name_short = p["name"]
        tooltip = hc["message"]
        status_html += '<span class="llm-dot" title="' + tooltip + '"><span class="dot ' + dot_class + '"></span>' + name_short + '</span>'
    status_html += '</div>'
    st.markdown(status_html, unsafe_allow_html=True)

    st.markdown("""
    <div class="logo-container">
        <div class="logo-icon">SC</div>
        <div>
            <div style="font-size: 24px; font-weight: 700; color: #E0E0E0;">SimpleC</div>
            <div style="font-size: 12px; color: #8892A0;">AI Test Generator v2</div>
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

    fb_stats = feedback.get_stats()
    if fb_stats["total"] > 0:
        st.markdown('<div class="section-header">Качество</div>', unsafe_allow_html=True)
        c1, c2 = st.columns(2)
        c1.metric("Оценок", fb_stats["total"])
        c2.metric("Позитивных", fb_stats["positive"])


tab1, tab2, tab3 = st.tabs(["Генерация", "Эталоны", "О системе"])

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
    try:
        from vector_store import VectorStore
        vs = VectorStore()
        pairs_col = vs.pairs
        all_pairs = pairs_col.get(include=["metadatas", "documents"])
        if all_pairs and all_pairs["ids"]:
            st.markdown("**Всего пар:** " + str(len(all_pairs["ids"])))
            for i, pid in enumerate(all_pairs["ids"]):
                meta = all_pairs["metadatas"][i] if all_pairs["metadatas"] else {}
                doc = all_pairs["documents"][i] if all_pairs["documents"] else ""
                feat_name = meta.get("feature", "?")
                src = meta.get("source", "?")
                with st.expander(pid + " | " + feat_name + " | " + src):
                    st.text(doc[:1000])
                    if st.button("Удалить", key="del_" + pid):
                        pairs_col.delete(ids=[pid])
                        st.success("Удален: " + pid)
                        st.rerun()
        else:
            st.info("Эталонов пока нет")
    except Exception as e:
        st.error("Ошибка: " + str(e))

with tab3:
    st.markdown("### SimpleC v2")
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
