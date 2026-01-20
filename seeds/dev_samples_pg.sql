INSERT INTO test_case(key, title, description, status)
VALUES ('CASE-HELLO', 'Hello world case', 'Кейс для демо', 'ready')
ON CONFLICT (key) DO NOTHING;

INSERT INTO test_data(key, name, type, version, content_json, tags_json)
VALUES (
  'user_set', 'Набор пользователей по умолчанию', 'json', '1.0.0',
  '{"users":[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]}',
  '["smoke","users"]'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO test_data(key, name, type, version, content_json, tags_json)
VALUES (
  'expected_user_set', 'Ожидаемый набор', 'json', '1.0.0',
  '{"users":[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]}',
  '["expected"]'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO test_case_data(test_case_id, test_data_id, role, version_pin, required, notes)
SELECT tc.id, td.id, 'input', '1.0.0', TRUE, 'основной ввод'
FROM test_case tc
JOIN test_data td ON td.key = 'user_set'
WHERE tc.key = 'CASE-HELLO'
  AND NOT EXISTS (
    SELECT 1 FROM test_case_data tcd
    WHERE tcd.test_case_id = tc.id
      AND tcd.test_data_id = td.id
      AND tcd.role = 'input'
      AND COALESCE(tcd.version_pin,'') = '1.0.0'
  );

INSERT INTO test_case_data(test_case_id, test_data_id, role, version_pin, required, notes)
SELECT tc.id, td.id, 'expected', '1.0.0', TRUE, 'ожидание'
FROM test_case tc
JOIN test_data td ON td.key = 'expected_user_set'
WHERE tc.key = 'CASE-HELLO'
  AND NOT EXISTS (
    SELECT 1 FROM test_case_data tcd
    WHERE tcd.test_case_id = tc.id
      AND tcd.test_data_id = td.id
      AND tcd.role = 'expected'
      AND COALESCE(tcd.version_pin,'') = '1.0.0'
  );
