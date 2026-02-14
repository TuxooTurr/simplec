"""
tc_formatter — форматирование тест-кейсов.
Разбивка XML по 10 кейсов, конвертация в таблицу и CSV.
"""

import re
import csv
import io


def parse_test_cases_from_xml(xml_text):
    """Парсит XML и возвращает список тест-кейсов."""
    cases = []
    pattern = re.compile(
        r"<testCase[^>]*>(.*?)</testCase>",
        re.DOTALL
    )
    for match in pattern.finditer(xml_text):
        tc_xml = match.group(0)
        tc_body = match.group(1)

        name = _extract_tag(tc_body, "name")
        steps = _parse_steps(tc_body)
        cases.append({
            "name": name,
            "xml": tc_xml,
            "steps": steps,
        })
    return cases


def _extract_tag(text, tag):
    """Извлекает содержимое тега."""
    m = re.search(
        r"<" + tag + r"[^>]*>(.*?)</" + tag + r">",
        text, re.DOTALL
    )
    if not m:
        return ""
    content = m.group(1).strip()
    # Убираем CDATA
    content = re.sub(r"<!$$CDATA\[", "", content)
    content = re.sub(r"$$\]>", "", content)
    return content.strip()


def _parse_steps(tc_body):
    """Парсит шаги тест-кейса."""
    steps = []
    step_pattern = re.compile(
        r"<step[^>]*>(.*?)</step>", re.DOTALL
    )
    for sm in step_pattern.finditer(tc_body):
        step_body = sm.group(1)
        action = _extract_tag(step_body, "action")
        test_data = _extract_tag(step_body, "testData")
        if not test_data:
            test_data = _extract_tag(step_body, "data")
        expected = _extract_tag(step_body, "expectedResult")
        if not expected:
            expected = _extract_tag(step_body, "expected")
        steps.append({
            "action": _clean_html(action),
            "test_data": _clean_html(test_data),
            "expected": _clean_html(expected),
        })
    return steps


def _clean_html(text):
    """Убирает HTML-теги и CDATA."""
    # Убираем CDATA обёртки
    text = re.sub(r"<!$$CDATA\[", "", text)
    text = re.sub(r"$$\]>", "", text)
    # Убираем HTML-теги
    clean = re.sub(r"<[^>]+>", "", text)
    # Декодируем entities
    clean = clean.replace("&lt;", "<").replace("&gt;", ">")
    clean = clean.replace("&amp;", "&").replace("&quot;", '"')
    clean = clean.replace("&apos;", "'")
    return clean.strip()



def split_xml_by_chunks(xml_text, feature_name, max_per_file=10):
    """Разбивает XML на файлы по max_per_file кейсов."""
    cases = parse_test_cases_from_xml(xml_text)
    if not cases:
        return [{"filename": feature_name + ".xml", "xml": xml_text}]

    # Извлекаем обёртку (header/footer)
    header_match = re.match(
        r"(.*?)<testCase", xml_text, re.DOTALL
    )
    footer_match = re.search(
        r"</testCase>([^<]*(?:<(?!/testCase)[^<]*)*$)",
        xml_text, re.DOTALL
    )
    header = header_match.group(1) if header_match else '<?xml version="1.0"?>\n<testCases>\n'
    footer = footer_match.group(1) if footer_match else "\n</testCases>"

    chunks = []
    for i in range(0, len(cases), max_per_file):
        chunk = cases[i:i + max_per_file]
        chunk_num = (i // max_per_file) + 1
        total_chunks = (len(cases) + max_per_file - 1) // max_per_file

        if total_chunks == 1:
            fname = feature_name + ".xml"
        else:
            fname = feature_name + "_" + str(chunk_num) + ".xml"

        body = "\n".join(c["xml"] for c in chunk)
        chunks.append({
            "filename": fname,
            "xml": header + body + footer,
            "cases": chunk,
        })
    return chunks


def cases_to_csv(cases):
    """Конвертирует тест-кейсы в CSV."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Тест-кейс", "Шаг", "Действие",
        "Тестовые данные", "Ожидаемый результат"
    ])
    for tc in cases:
        for idx, step in enumerate(tc["steps"], 1):
            writer.writerow([
                tc["name"] if idx == 1 else "",
                idx,
                step["action"],
                step["test_data"],
                step["expected"],
            ])
    return output.getvalue()

