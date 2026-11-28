#!/usr/bin/env python3
"""Register a test bot webhook through the authenticated CRM server."""
import getpass
import json
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    base = input('HTTPS-адрес вашего сервиса Render (например, https://example.onrender.com): ').strip().rstrip('/')
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        print('Нужен HTTPS-адрес сервиса без пути, логина и параметров.', file=sys.stderr)
        return 1
    print('Внимание: webhook этого бота будет заменён. Используйте только тестового бота.')
    if input('Продолжить? Введите ДА: ').strip().upper() != 'ДА':
        print('Отменено.'); return 0
    login = input('Логин управляющего: ').strip()
    password = getpass.getpass('Пароль управляющего (не отображается): ')
    opener = urllib.request.build_opener(NoRedirect())
    try:
        payload = json.dumps({'login': login, 'password': password}).encode('utf-8')
        auth = urllib.request.Request(base+'/api/auth/login', data=payload, headers={'Content-Type':'application/json'}, method='POST')
        with opener.open(auth, timeout=35) as response:
            token = json.load(response)['token']
        request = urllib.request.Request(base+'/api/setup-webhook', data=b'{}', headers={'Authorization':'Bearer '+token, 'Content-Type':'application/json'}, method='POST')
        with opener.open(request, timeout=35) as response:
            result = json.load(response)
        if result.get('ok') is True:
            print('Бот подключён. Напишите ему тестовое сообщение.')
            return 0
        print('Сервер не подтвердил подключение. Проверьте настройки.', file=sys.stderr)
    except urllib.error.HTTPError as error:
        print(f'Подключение не выполнено (HTTP {error.code}). Проверьте учётную запись управляющего и настройки сервиса.', file=sys.stderr)
    except (urllib.error.URLError, ValueError, KeyError, TimeoutError):
        print('Не удалось обратиться к серверу. Проверьте его HTTPS-адрес и соединение.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
