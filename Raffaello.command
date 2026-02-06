#!/bin/zsh -l
set -e

# przejdź do folderu, w którym leży ten plik (czyli folder projektu)
cd "$(dirname "$0")"

# jakby Finder miał biedny PATH (częste), to mu pomagamy:
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "== Raffaello start =="
echo "Katalog: $(pwd)"
node -v
npm -v
echo "====================="

npm start
