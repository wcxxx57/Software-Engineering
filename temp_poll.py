import requests, time, json
url = 'http://localhost:8081/api/v1/tasks/5b03f776-1222-4ad9-ac65-0bbefac02b9c'
headers = {'X-API-Key': 'dev-api-key-12345'}

for i in range(120):
    try:
        r = requests.get(url, headers=headers, timeout=10)
    except Exception as e:
        print(f'[{i}] request_err: {e}')
        time.sleep(20)
        continue

    print(f'[{i}] status_code={r.status_code}')
    print(r.text)
    if r.status_code == 200:
        try:
            js = r.json()
        except Exception:
            js = None
        if js and js.get('status') in ('SUCCESS', 'FAILURE'):
            print('DONE', json.dumps(js, ensure_ascii=False))
            break
    time.sleep(20)
