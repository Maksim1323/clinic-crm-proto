# Публичный сертификат НУЦ Минцифры для GigaChat

`russian-trusted-root-ca.pem` — публичный корневой сертификат, а не секрет и не приватный ключ. Получен по HTTPS с портала Госуслуг: https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt, ссылка приведена в [официальных инструкциях GigaChat](https://developers.sber.ru/docs/ru/gigachat/certificates).

SHA-256 отпечаток сертификата (не хеш PEM-файла): `D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31`. Subject: Russian Trusted Root CA, срок до 27 февраля 2032 UTC. Проверить можно командой `openssl x509 -in certs/russian-trusted-root-ca.pem -noout -subject -dates -fingerprint -sha256`.

Этот CA предоставляется только отдельному TLS-диспетчеру для двух фиксированных HTTPS-адресов GigaChat. Проверка TLS и имени сервера остаётся включённой, переадресации запрещены. Не добавляйте приватные ключи и не отключайте проверку TLS. Сертификат имеет срок действия и может быть отозван или заменён; сопровождающий должен отслеживать актуальность источника.
