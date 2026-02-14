import re
import html
import xml.etree.ElementTree as ET
from typing import List, Dict


def fix_broken_cdata(xml_text: str) -> str:
    # Normalize all broken CDATA closings before XML closing tags
    # Matches: 1-3 brackets + optional > + </ and replaces with ]]></
    # But must NOT touch already correct ]]></
    # Step 1: temporarily protect correct ]]>
    xml_text = xml_text.replace(']]>', '\x00CDCLOSE\x00')
    # Step 2: fix broken patterns - any combo of ] before </
    xml_text = re.sub(r'\]{1,3}>?</', ']]></', xml_text)
    # Step 3: restore protected
    xml_text = xml_text.replace('\x00CDCLOSE\x00', ']]>')
    return xml_text


def clean_text(text):
    if not text:
        return ""
    text = str(text).strip()
    # Remove CDATA wrappers: full <![CDATA[...]]> or broken variants
    # First strip opening tag
    while text.startswith("<![CDATA["):
        text = text[9:]
    # Strip closing: ]]> or ]] at the very end
    if text.endswith("]]>"):
        text = text[:-3]
    elif text.endswith("]]"):
        text = text[:-2].replace("]]", "")
    text = re.sub(r'<strong>(.*?)</strong>', r'\1', text, flags=re.DOTALL)
    text = re.sub(r'<ul>\s*', '', text)
    text = re.sub(r'</ul>\s*', '', text)
    text = re.sub(r'<li>(.*?)</li>', '\u2022 \\1\n', text, flags=re.DOTALL)
    text = re.sub(r'<br\s*/?>', '\n', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'\n\s*\n+', '\n', text)
    text = html.unescape(text)
    return text.strip()


def get_step_text(step, tag_names):
    for tag in tag_names:
        el = step.find(tag)
        if el is not None:
            txt = el.text if el.text else ""
            return clean_text(txt)
    return ""


def parse_test_cases_from_xml(xml_text: str) -> List[Dict]:
    cases = []
    if not xml_text:
        return cases
    xml_text = xml_text.strip()
    if xml_text.startswith("```"):
        xml_text = re.sub(r'^```\w*\n?', '', xml_text)
        xml_text = re.sub(r'\n?```$', '', xml_text)
    xml_text = fix_broken_cdata(xml_text)
    xml_parts = re.split(r'(?=<\?xml\s+version)', xml_text)
    xml_parts = [p.strip() for p in xml_parts if p.strip()]
    for xml_part in xml_parts:
        parsed = False
        try:
            ot = xml_part.count('<testCase>')
            ct = xml_part.count('</testCase>')
            if ot > ct:
                xml_part += '</steps></testScript></testCase>' * (ot - ct)
            ots = xml_part.count('<testCases>')
            cts = xml_part.count('</testCases>')
            if ots > cts:
                xml_part += '</testCases>' * (ots - cts)
            root = ET.fromstring(xml_part)
            test_cases = root.findall(".//testCase")
            if not test_cases and root.tag == "testCase":
                test_cases = [root]
            for tc in test_cases:
                name_el = tc.find("name")
                name = clean_text(name_el.text) if name_el is not None and name_el.text else "Unnamed"
                steps = []
                ts = tc.find("testScript")
                se = ts.find("steps") if ts is not None else tc.find("steps")
                if se is not None:
                    for step in se.findall("step"):
                        action = get_step_text(step, ["description", "action"])
                        test_data = get_step_text(step, ["testData", "test-data", "data"])
                        expected = get_step_text(step, ["expectedResult", "expected-result", "expected"])
                        steps.append({"action": action, "test_data": test_data, "expected": expected})
                cases.append({"name": name, "steps": steps})
            parsed = True
        except ET.ParseError as e:
            print(f"ParseError: {e}")
        if not parsed:
            cases.extend(parse_with_regex(xml_part))
    return cases


def parse_with_regex(xml_text: str) -> List[Dict]:
    cases = []
    for tc_m in re.finditer(r'<testCase[^>]*>(.*?)</testCase>', xml_text, re.DOTALL):
        tc = tc_m.group(1)
        nm = re.search(r'<name[^>]*>(.*?)</name>', tc, re.DOTALL)
        name = clean_text(nm.group(1)) if nm else "Unnamed"
        steps = []
        for sm in re.finditer(r'<step[^>]*>(.*?)</step>', tc, re.DOTALL):
            sc = sm.group(1)
            action = _rx(sc, ["description", "action"])
            td = _rx(sc, ["testData", "test-data"])
            exp = _rx(sc, ["expectedResult", "expected-result"])
            steps.append({"action": action, "test_data": td, "expected": exp})
        if steps:
            cases.append({"name": name, "steps": steps})
    return cases


def _rx(content, tags):
    for tag in tags:
        m = re.search(rf'<{tag}[^>]*>(.*?)</{tag}>', content, re.DOTALL)
        if m:
            return clean_text(m.group(1))
    return ""


def split_xml_by_chunks(xml_text, base_name, chunk_size=10):
    cases = parse_test_cases_from_xml(xml_text)
    if not cases:
        return [{"filename": f"{base_name}.xml", "content": xml_text, "count": 0}]
    chunks = []
    for i in range(0, len(cases), chunk_size):
        chunk = cases[i:i+chunk_size]
        num = i // chunk_size + 1
        xml = '<?xml version="1.0" encoding="UTF-8"?>\n<testCases>\n'
        for tc in chunk:
            xml += f'  <testCase>\n    <name><![CDATA[{tc["name"]}]]></name>\n'
            xml += '    <testScript type="steps">\n      <steps>\n'
            for j, s in enumerate(tc["steps"]):
                xml += f'        <step index="{j}">\n'
                xml += f'          <description><![CDATA[{s["action"]}]]></description>\n'
                xml += f'          <testData><![CDATA[{s["test_data"]}]]></testData>\n'
                xml += f'          <expectedResult><![CDATA[{s["expected"]}]]></expectedResult>\n'
                xml += '        </step>\n'
            xml += '      </steps>\n    </testScript>\n  </testCase>\n'
        xml += '</testCases>'
        chunks.append({"filename": f"{base_name}_part{num}.xml", "content": xml, "count": len(chunk)})
    return chunks


def cases_to_csv(cases):
    import csv, io
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Test Case", "Step", "Action", "Test Data", "Expected Result"])
    for tc in cases:
        for i, s in enumerate(tc["steps"], 1):
            w.writerow([tc["name"] if i == 1 else "", i, s["action"], s["test_data"], s["expected"]])
    return out.getvalue()
