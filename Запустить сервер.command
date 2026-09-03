#!/bin/zsh
# Запуск локального сервера «Сюжет-Студии» и открытие в браузере
cd "$(dirname "$0")"
PORT=8765
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)

# порт занят — разбираемся, чем именно (POST-проба: server.py отвечает 405, старый http.server — 501)
if lsof -ti :$PORT >/dev/null 2>&1; then
    CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST -d '{}' "http://localhost:$PORT/index.html" 2>/dev/null)
    if [ "$CODE" = "405" ]; then
        echo "Сервер (server.py) уже запущен — открываю страницу."
        open "http://localhost:$PORT"
        exit 0
    elif [ "$CODE" = "501" ]; then
        echo "На порту $PORT старый «http.server» без поддержки записи имён — перезапускаю на server.py…"
        for P in $(lsof -ti :$PORT); do
            ps -p "$P" -o command= | grep -q "http.server" && kill "$P" 2>/dev/null
        done
        sleep 0.6
    else
        echo "Порт $PORT занят другим приложением (POST → HTTP $CODE)."
        echo "Освободите порт или поменяйте PORT в начале этого файла."
        exit 1
    fi
fi

python3 server.py "$PORT" &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT INT TERM

# ждём, пока сервер начнёт принимать соединения (до ~5 с), затем открываем браузер
for i in {1..50}; do
    curl -s -o /dev/null "http://localhost:$PORT/" && break
    sleep 0.1
done
open "http://localhost:$PORT" 2>/dev/null

echo "=============================================="
echo "  Сюжет-Студия запущена"
echo "  На этом Mac:      http://localhost:$PORT"
[ -n "$IP" ] && echo "  В сети (для коллег): http://$IP:$PORT"
echo "  Остановить: Ctrl+C"
echo "=============================================="
wait $SRV
