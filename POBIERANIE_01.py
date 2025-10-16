from selenium import webdriver
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
import time, csv, os, sys

# --- Ścieżki ---
firefox_path = r"C:\Program Files\Mozilla Firefox\firefox.exe"
geckodriver_path = r"C:\Tools\geckodriver\geckodriver.exe"
profile_path = r"C:\Users\48503\AppData\Roaming\Mozilla\Firefox\Profiles\hru5y53p.default-release-1719774413408"

# --- Konfiguracja Firefoksa ---
options = Options()
options.binary_location = firefox_path
options.profile = webdriver.FirefoxProfile(profile_path)
# options.add_argument("--headless")  # odkomentuj jeśli chcesz działać w tle

service = Service(geckodriver_path)
driver = webdriver.Firefox(service=service, options=options)

try:
    url = "https://play.qobuz.com/label/1171"
    print(f"🌐 Otwieram stronę: {url}")
    driver.get(url)
    time.sleep(5)

    # --- Znajdź kontener przewijania ---
    try:
        scroll_container = driver.find_element(By.CSS_SELECTOR, "div[class*='scroll']")
    except:
        scroll_container = driver.find_element(By.TAG_NAME, "body")

    print("\n🔽 Rozpoczynam przewijanie strony...\n")

    links_set = set()
    last_count = 0
    last_update_time = time.time()
    timeout_idle = 40  # czas bez nowych albumów (s)
    actions = ActionChains(driver)
    iteration = 0

    def progress_bar(count, width=40):
        filled = int(width * min(count, 8000) / 8000)  # proporcja do max ~1000 albumów
        bar = "█" * filled + "-" * (width - filled)
        sys.stdout.write(f"\r📀 Znaleziono {count} albumów | [{bar}]")
        sys.stdout.flush()

    while True:
        iteration += 1
        # Scroll w dół
        driver.execute_script("arguments[0].scrollTo(0, arguments[0].scrollHeight);", scroll_container)
        time.sleep(0.3)

        # Minimalny scroll JS w górę/dół (aktywizacja strony)
        driver.execute_script("window.scrollBy(0, 15);")
        driver.execute_script("window.scrollBy(0, -15);")

        # Scroll kółkiem (ActionChains)
        try:
            actions.scroll_by_amount(0, 100).perform()
        except:
            pass  # w razie błędu ignorujemy

        # Zbieranie linków do albumów
        album_elements = driver.find_elements(By.CSS_SELECTOR, "a[href*='/album/']")
        for a in album_elements:
            try:
                href = a.get_attribute("href")
                if href and href.startswith("https://play.qobuz.com/album/"):
                    links_set.add(href)
            except:
                continue

        progress_bar(len(links_set))

        # Sprawdzenie, czy pojawiły się nowe albumy
        if len(links_set) > last_count:
            last_count = len(links_set)
            last_update_time = time.time()
        elif time.time() - last_update_time > timeout_idle:
            print(f"\n\n✅ Koniec przewijania — brak nowych albumów przez {timeout_idle} s.\n")
            break

    # --- Zbieranie i sortowanie linków ---
    links = sorted(links_set)
    print(f"\n📦 Znaleziono {len(links)} unikalnych linków do albumów.\n")

    # --- Zapis do CSV ---
    output_path = os.path.join(os.getcwd(), "album_links.csv")
    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Link"])
        for link in links:
            writer.writerow([link])

    print(f"\n💾 Zapisano do pliku: {output_path}")

finally:
    driver.quit()
