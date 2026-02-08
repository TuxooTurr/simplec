import streamlit as st
import sys
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "db"))
sys.path.insert(0, str(ROOT / "agents"))

from test_generator import TestGeneratorAgent
from qa_doc_generator import QADocGenerator
from file_parser import parse_file
from feedback_store import FeedbackStore

st.set_page_config(
    page_title="SimpleC",
    page_icon="🧪",
    layout="wide",
    initial_sidebar_state="expanded"
)

st.markdown("""
<style>
    div[data-baseweb="select"] {
        background-color: #262730;
        border: 1px solid #4a4a5a;
        border-radius: 8px;
    }
    div[data-baseweb="select"]:hover {
        border-color: #1E88E5;
    }
    div[data-baseweb="select"] > div {
        background-color: #262730 !important;
        color: #fafafa !important;
    }
    ul[role="listbox"] {
        background-color: #1e1e2e !important;
        border: 1px solid #4a4a5a !important;
    }
    li[role="option"] { color: #fafafa !important; }
    li[role="option"]:hover { background-color: #1E88E5 !important; }
    span[data-baseweb="tag"] {
        background-color: #1E88E5 !important;
        color: white !important;
    }
    .stTextInput > div > div {
        background-color: #262730;
        border: 1px solid #4a4a5a;
        border-radius: 8px;
    }
    .copy-hint {
        background: #1E88E5;
        color: white;
        padding: 0.5rem 1rem;
        border-radius: 5px;
        font-size: 0.85rem;
        margin-bottom: 1rem;
        display: inline-block;
    }
</style>
""", unsafe_allow_html=True)


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

if "generated" not in st.session_state:
    st.session_state.generated = False
if "tc_result" not in st.session_state:
    st.session_state.tc_result = None
if "qa_doc_result" not in st.session_state:
    st.session_state.qa_doc_result = None
if "requirement_text" not in st.session_state:
    st.session_state.requirement_text = ""
if "fb_tc_given" not in st.session_state:
    st.session_state.fb_tc_given = False
if "fb_qa_given" not in st.session_state:
    st.session_state.fb_qa_given = False

with st.sidebar:
    st.markdown("## Настройки")
    platform = st.selectbox("Платформа", ["W", "M", "A"], index=0)
    feature = st.text_input("Фича", value="INCIDENT_TEMPLATE")
    domain = st.multiselect(
        "Домен", options=["Omega", "Sigma", "Mobile"],
        default=["Omega"]
    )
    team = st.text_input(
        "Команда",
        value="Канальный агент и агенты эксперты [00G10014]"
    )
    system = st.selectbox("АС", options=AC_LIST, index=0)

    st.markdown("---")
    col1, col2 = st.columns(2)
    with col1:
        n_etalons = st.number_input(
            "Эталонов", min_value=1, max_value=10, value=3
        )
    with col2:
        max_tc = st.number_input(
            "Макс. ТК", min_value=1, max_value=20, value=10
        )

    st.markdown("---")
    st.markdown("## База эталонов")
    c1, c2, c3 = st.columns(3)
    c1.metric("Треб.", stats["db"]["requirements"])
    c2.metric("ТК", stats["db"]["test_cases"])
    c3.metric("Пары", stats["db"]["pairs"])

    st.markdown("---")
    st.markdown("## Качество")
    if fb_stats["total"] > 0:
        fc1, fc2 = st.columns(2)
        fc1.metric(
            "Оценок", fb_stats["total"],
            delta=str(fb_stats["approval_rate"]) + "% ok"
        )
        fc2.metric(
            "Результат",
            str(fb_stats["positive"]) + " / " + str(fb_stats["negative"])
        )
    else:
        st.caption("Оценок пока нет")

    st.markdown("---")
    llm_ok = stats["auth_key_set"]
    st.markdown("LLM: **GigaChat** " + ("ok" if llm_ok else "no"))

st.title("SimpleC")
st.caption("RAG-генератор тест-кейсов и документации для QA")

generated = st.session_state.generated

if generated:
    tab_qa_label = "Описание фичи для QA"
else:
    tab_qa_label = "Описание фичи для QA (locked)"

tab1, tab2, tab3, tab4 = st.tabs([
    "Тест-кейсы", tab_qa_label, "Качество", "О системе"
])

domain_str = ", ".join(domain) if domain else "Omega"

with tab1:
    requirement = ""
    use_text = st.toggle("Ввести текст вручную", value=False)

    if use_text:
        requirement = st.text_area(
            "Введите требование:", height=200,
            placeholder="Вставьте текст требования..."
        )
    else:
        uploaded_files = st.file_uploader(
            "Загрузите файлы с требованиями:",
            type=["pdf", "docx", "doc", "xlsx", "xls",
                  "xml", "png", "jpg", "jpeg", "txt"],
            accept_multiple_files=True
        )
        if uploaded_files:
            all_texts = []
            for uf in uploaded_files:
                with st.spinner("Обработка " + uf.name + "..."):
                    text = parse_file(uf.read(), uf.name)
                    all_texts.append("=== " + uf.name + " ===\n" + text)
                    with st.expander(
                        uf.name + " (" + str(len(text)) + " сим.)"
                    ):
                        st.text(text[:2000])
            requirement = "\n\n".join(all_texts)
            st.success(
                "Загружено: " + str(len(uploaded_files))
                + " | " + str(len(requirement)) + " символов"
            )

    feature_name = st.text_input(
        "Название фичи (для документации QA):",
        value="",
        placeholder="Например: RAG-поиск шаблонов ТКС"
    )

    st.markdown("---")
    col_btn1, col_btn2, _ = st.columns([1, 1, 3])

    with col_btn1:
        btn_preview = st.button("Превью", use_container_width=True)
    with col_btn2:
        btn_generate = st.button(
            "Генерировать", type="primary", use_container_width=True
        )

    if btn_preview and requirement:
        with st.spinner("Ищу эталоны..."):
            from vector_store import VectorStore
            vs = VectorStore()
            req_types = agent._classify_requirement(requirement)
            pairs = vs.find_similar_pairs(
                requirement, n_results=n_etalons, platform=platform
            )
        st.markdown("**Типы блоков:** " + ", ".join(req_types))
        if pairs:
            for p in pairs:
                dist = p["distance"]
                if dist < 0.3:
                    color = "green"
                elif dist < 0.5:
                    color = "yellow"
                else:
                    color = "red"
                with st.expander(
                    "[" + p["id"] + "] dist=" + str(round(dist, 4))
                ):
                    st.text(p["document"][:500])

    if btn_generate and requirement:
        if not llm_ok:
            st.error("GigaChat AUTH_KEY не задан.")
        else:
            progress = st.progress(0, text="Генерирую тест-кейсы...")
            tc_result = agent.generate(
                requirement=requirement, platform=platform,
                feature=feature, domain=domain_str, team=team,
                system=system, folder="Новая ТМ",
                n_etalons=n_etalons, max_test_cases=max_tc,
            )
            progress.progress(50, text="Генерирую документацию QA...")
            qa_result = qa_doc.generate(
                requirement=requirement, feature_name=feature_name
            )
            progress.progress(100, text="Готово!")

            st.session_state.tc_result = tc_result
            st.session_state.qa_doc_result = qa_result
            st.session_state.requirement_text = requirement
            st.session_state.generated = True
            st.session_state.fb_tc_given = False
            st.session_state.fb_qa_given = False
            st.rerun()

    if btn_generate and not requirement:
        st.warning("Загрузите файл или введите текст")

    if st.session_state.tc_result and st.session_state.generated:
        result = st.session_state.tc_result
        if result.get("error"):
            st.error(result["error"])
        else:
            st.success(
                "Тест-кейсов: " + str(result["test_cases_count"])
                + " | Эталонов: " + str(result["etalons_used"])
            )
            col_m1, col_m2, col_m3 = st.columns(3)
            col_m1.metric("Тест-кейсов", result["test_cases_count"])
            col_m2.metric("Эталонов", result["etalons_used"])
            col_m3.metric("Типы", ", ".join(result["requirement_types"]))

            if result.get("similar_pairs"):
                with st.expander("Использованные эталоны"):
                    for p in result["similar_pairs"]:
                        st.markdown(
                            "- " + p["id"] + " dist="
                            + str(round(p["distance"], 4))
                        )

            st.markdown("### Результат XML")
            st.code(result["xml"], language="xml")

            ts_file = datetime.now().strftime("%Y%m%d_%H%M%S")
            st.download_button(
                label="Скачать XML",
                data=result["xml"],
                file_name="test_cases_" + ts_file + ".xml",
                mime="application/xml", type="primary"
            )

            st.markdown("---")
            st.markdown("### Оцените тест-кейсы")

            if st.session_state.fb_tc_given:
                st.success("Спасибо за оценку!")
            else:
                col_up, col_down, _ = st.columns([1, 1, 3])
                with col_up:
                    if st.button("Хорошо", key="tc_up", use_container_width=True):
                        feedback.add_feedback(
                            generation_type="test_cases",
                            rating="positive",
                            requirement_preview=st.session_state.requirement_text,
                            result_preview=result["xml"][:500],
                            platform=platform, feature=feature,
                            etalons_used=result["etalons_used"],
                            test_cases_count=result["test_cases_count"],
                        )
                        st.session_state.fb_tc_given = True
                        st.rerun()
                with col_down:
                    if st.button("Плохо", key="tc_down", use_container_width=True):
                        st.session_state.show_tc_comment = True

                if st.session_state.get("show_tc_comment"):
                    tc_comment = st.text_area(
                        "Что не так?",
                        placeholder="Опишите проблему...",
                        key="tc_comment_input"
                    )
                    if st.button("Отправить", key="tc_send"):
                        feedback.add_feedback(
                            generation_type="test_cases",
                            rating="negative",
                            requirement_preview=st.session_state.requirement_text,
                            result_preview=result["xml"][:500],
                            comment=tc_comment,
                            platform=platform, feature=feature,
                            etalons_used=result["etalons_used"],
                            test_cases_count=result["test_cases_count"],
                        )
                        st.session_state.fb_tc_given = True
                        st.session_state.show_tc_comment = False
                        st.rerun()

            st.info("Перейдите на вкладку Описание фичи для QA")

    if st.session_state.generated:
        st.markdown("---")
        if st.button("Новая генерация"):
            st.session_state.generated = False
            st.session_state.tc_result = None
            st.session_state.qa_doc_result = None
            st.session_state.requirement_text = ""
            st.session_state.fb_tc_given = False
            st.session_state.fb_qa_given = False
            st.rerun()

with tab2:
    if not st.session_state.generated:
        st.markdown("### Описание фичи для QA (заблокировано)")
        st.info("Сначала сгенерируйте на вкладке Тест-кейсы")
    else:
        qa_result = st.session_state.qa_doc_result
        if not qa_result or qa_result.get("error"):
            err = qa_result.get("error", "") if qa_result else ""
            st.error("Ошибка: " + err)
        else:
            st.markdown("### " + qa_result.get("feature_name", "Документация"))
            col_s1, col_s2, col_s3 = st.columns(3)
            col_s1.metric("Разделов", qa_result["sections"])
            col_s2.metric("Чек-лист", qa_result["checklist_items"])
            col_s3.metric("Символов", len(qa_result["doc"]))

            st.markdown("---")
            st.markdown(
                '<div class="copy-hint">'
                "Нажмите иконку копирования справа для Confluence"
                "</div>",
                unsafe_allow_html=True
            )
            st.code(qa_result["doc"], language="markdown")

            st.markdown("---")
            st.markdown("### Оцените документацию")

            if st.session_state.fb_qa_given:
                st.success("Спасибо за оценку!")
            else:
                col_up2, col_down2, _ = st.columns([1, 1, 3])
                with col_up2:
                    if st.button("Хорошо", key="qa_up", use_container_width=True):
                        feedback.add_feedback(
                            generation_type="qa_doc",
                            rating="positive",
                            requirement_preview=st.session_state.requirement_text,
                            result_preview=qa_result["doc"][:500],
                            platform=platform, feature=feature,
                            sections_count=qa_result["sections"],
                        )
                        st.session_state.fb_qa_given = True
                        st.rerun()
                with col_down2:
                    if st.button("Плохо", key="qa_down", use_container_width=True):
                        st.session_state.show_qa_comment = True

                if st.session_state.get("show_qa_comment"):
                    qa_comment = st.text_area(
                        "Что не так?",
                        placeholder="Опишите проблему...",
                        key="qa_comment_input"
                    )
                    if st.button("Отправить", key="qa_send"):
                        feedback.add_feedback(
                            generation_type="qa_doc",
                            rating="negative",
                            requirement_preview=st.session_state.requirement_text,
                            result_preview=qa_result["doc"][:500],
                            comment=qa_comment,
                            platform=platform, feature=feature,
                            sections_count=qa_result["sections"],
                        )
                        st.session_state.fb_qa_given = True
                        st.session_state.show_qa_comment = False
                        st.rerun()

            st.markdown("---")
            col_dl, col_db, _ = st.columns([1, 1, 3])
            with col_dl:
                ts_dl = datetime.now().strftime("%Y%m%d_%H%M%S")
                st.download_button(
                    label="Скачать .md",
                    data=qa_result["doc"],
                    file_name="qa_doc_" + ts_dl + ".md",
                    mime="text/markdown", type="primary", key="dl_qa"
                )
            with col_db:
                if st.button("Добавить в БД", type="secondary", key="add_db"):
                    try:
                        from vector_store import VectorStore
                        vs = VectorStore()
                        ts2 = datetime.now().strftime("%Y%m%d%H%M%S")
                        req_text = st.session_state.requirement_text
                        tc_xml = ""
                        if st.session_state.tc_result:
                            tc_xml = st.session_state.tc_result.get("xml", "")
                        req_id = "REQ-USER-" + ts2
                        vs.add_requirement(
                            req_id=req_id, text=req_text,
                            metadata={
                                "platform": platform,
                                "feature": feature,
                                "source": "user_generated",
                                "created": ts2,
                            }
                        )
                        pair_id = ""
                        if tc_xml:
                            pair_id = "PAIR-USER-" + ts2
                            vs.add_pair(
                                pair_id=pair_id,
                                requirement_text=req_text,
                                test_case_xml=tc_xml,
                                metadata={
                                    "platform": platform,
                                    "feature": feature,
                                    "source": "user_generated",
                                    "created": ts2,
                                }
                            )
                        msg = "Добавлено! Требование: " + req_id
                        if pair_id:
                            msg = msg + " | Пара: " + pair_id
                        st.success(msg)
                        st.balloons()
                    except Exception as e:
                        st.error("Ошибка: " + str(e))

with tab3:
    st.markdown("### Статистика качества")

    fb_s = feedback.get_stats()

    if fb_s["total"] == 0:
        st.info("Оценок пока нет. Сгенерируйте и оцените результат.")
    else:
        col_a, col_b, col_c, col_d = st.columns(4)
        col_a.metric("Всего оценок", fb_s["total"])
        col_b.metric("Положительных", fb_s["positive"])
        col_c.metric("Отрицательных", fb_s["negative"])
        col_d.metric("Одобрение", str(fb_s["approval_rate"]) + "%")

        st.markdown("---")

        tc_fb = feedback.get_feedback_by_type("test_cases")
        qa_fb = feedback.get_feedback_by_type("qa_doc")

        col_t1, col_t2 = st.columns(2)

        with col_t1:
            st.markdown("#### Тест-кейсы")
            if tc_fb["total"] > 0:
                st.metric("Оценок", tc_fb["total"])
                st.metric("Одобрение", str(tc_fb["approval_rate"]) + "%")
                st.progress(tc_fb["approval_rate"] / 100)
            else:
                st.caption("Нет оценок")

        with col_t2:
            st.markdown("#### QA-документация")
            if qa_fb["total"] > 0:
                st.metric("Оценок", qa_fb["total"])
                st.metric("Одобрение", str(qa_fb["approval_rate"]) + "%")
                st.progress(qa_fb["approval_rate"] / 100)
            else:
                st.caption("Нет оценок")

        st.markdown("---")
        st.markdown("#### Последние отзывы")
        recent = feedback.get_recent(10)
        for fb in recent:
            if fb["rating"] == "positive":
                icon = "+"
            else:
                icon = "-"
            gen_label = "ТК" if fb["generation_type"] == "test_cases" else "QA"
            ts_str = fb["timestamp"][:16].replace("T", " ")
            with st.expander(
                icon + " [" + gen_label + "] " + ts_str
                + " - " + fb["requirement_preview"][:80]
            ):
                st.markdown("**Тип:** " + fb["generation_type"])
                st.markdown("**Платформа:** " + fb.get("platform", ""))
                st.markdown("**Фича:** " + fb.get("feature", ""))
                if fb["generation_type"] == "test_cases":
                    st.markdown(
                        "**ТК:** " + str(fb.get("test_cases_count", 0))
                        + " | **Эталонов:** "
                        + str(fb.get("etalons_used", 0))
                    )
                else:
                    st.markdown(
                        "**Разделов:** " + str(fb.get("sections_count", 0))
                    )
                if fb.get("comment"):
                    st.markdown("**Комментарий:** " + fb["comment"])
                st.markdown("**Требование:**")
                st.text(fb["requirement_preview"])

        neg = feedback.get_negative_feedback()
        commented = [fb for fb in neg if fb.get("comment")]
        if commented:
            st.markdown("---")
            st.markdown("#### Негативные с комментариями")
            for fb in commented:
                st.markdown(
                    "- **" + fb["timestamp"][:10] + "** ["
                    + fb["generation_type"] + "]: " + fb["comment"]
                )

with tab4:
    st.markdown("### О системе SimpleC")
    st.markdown(
        "**SimpleC** - RAG-система для генерации "
        "тест-кейсов и QA-документации."
    )
    st.markdown("#### Как работает")
    st.markdown(
        "1. Загрузите требование (файл или текст)\n"
        "2. Генерировать - создаст ТК + QA-документацию\n"
        "3. Оцените результат\n"
        "4. Если ОК - Добавить в БД для обогащения"
    )
    st.markdown("#### Форматы ввода")
    st.markdown("PDF, Word, Excel, XML, изображения (OCR), TXT")
    st.markdown("#### Архитектура")
    st.code(
        "Требование (файл / текст)\n"
        "    |\n"
        "    v\n"
        "Парсер (PDF/Word/Excel/XML/OCR)\n"
        "    |\n"
        "    +---> RAG + GigaChat --> XML тест-кейсы\n"
        "    |\n"
        "    +---> GigaChat --> Описание фичи для QA\n"
        "    |\n"
        "    v\n"
        "[Добавить в БД] --> ChromaDB\n"
        "[Оценка] --> feedback.json",
        language="text"
    )
    st.markdown("---")
    c1, c2, c3 = st.columns(3)
    c1.metric("Требований", stats["db"]["requirements"])
    c2.metric("Тест-кейсов", stats["db"]["test_cases"])
    c3.metric("Пар", stats["db"]["pairs"])

