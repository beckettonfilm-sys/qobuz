#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CD pipeline (TXT -> download MAX -> generate CD mockups)

Wersja zgodna z Twoimi założeniami:
- wejście: .txt w folderze skryptu, linie:  ID - LINK
- pobiera:
    * MAX  (zapis do pic_max/)  -> dla TIDAL próbuje wymusić 1280x1280
- generator mockupów:
    * okładki z pic_max/
    * template z CD_TEMPLATE/CD_BASE.jpg + CD_TEMPLATE/CD_REFLECTIONS.png
    * stałe: X=169, Y=34, SIDE=0 (bez skalowania), JPG_QUALITY=75
    * finalny zapis w pic_mini jest pomniejszony /4
    * zapis wyników do pic_mini/ (OUT nie używany)
    * brak wznawiania/skip: zawsze zapisuje (nadpisuje)
- Ctrl+C:
    * pierwszy Ctrl+C: prosi o zatrzymanie (nie zaczyna nowych zadań, dokańcza rozpoczęte)
    * drugi Ctrl+C: natychmiast kończy
"""

from __future__ import annotations

import asyncio
import os
import re
import signal
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import urlparse

try:
    import aiohttp  # type: ignore
except Exception:
    print("[STOP] Brak biblioteki 'aiohttp'. Zainstaluj: pip install aiohttp")
    raise

try:
    from PIL import Image  # type: ignore
except Exception:
    print("[STOP] Brak biblioteki 'Pillow'. Zainstaluj: pip install Pillow")
    raise

# Rich jest miły, ale nie wymagamy go na siłę.
_USE_RICH = True
try:
    from rich.console import Console  # type: ignore
    from rich.panel import Panel  # type: ignore
    from rich.progress import (  # type: ignore
        BarColumn,
        Progress,
        SpinnerColumn,
        TextColumn,
        TimeElapsedColumn,
        TimeRemainingColumn,
    )
except Exception:
    _USE_RICH = False

# =========================
# KONFIG
# =========================

SCRIPT_DIR = Path(__file__).resolve().parent

# Wejście: txt w folderze skryptu (jeśli kilka -> wybieramy najnowszy)
TXT_GLOB = "*.txt"

# Download
CONCURRENCY = 12
TIMEOUT_SEC = 40
RETRIES = 3
DOWNLOAD_OVERWRITE = False  # jeśli False i plik istnieje -> pomija download (oszczędza czas)

# Foldery
PIC_MAX_DIR = SCRIPT_DIR / "pic_max"                # MAX (ważny output)
MOCKUP_DIR = SCRIPT_DIR / "pic_mini"                # finalne mockupy (dawne OUT)
TEMPLATE_DIR = SCRIPT_DIR / "CD_TEMPLATE"
BASE_FILE = TEMPLATE_DIR / "CD_BASE.jpg"
REFL_FILE = TEMPLATE_DIR / "CD_REFLECTIONS.png"

# Generator (na sztywno)
PASTE_X = 169
PASTE_Y = 34
SIDE = 0  # 0 = brak skalowania
JPG_QUALITY = 75
MOCKUP_DOWNSCALE = 4  # finalny mockup = rozmiar bazy / 4

# Rozszerzenia, które uznajemy za obrazy w folderze wejściowym dla generatora
IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}

# =========================
# Ctrl+C: zatrzymanie łagodne / wymuszone
# =========================

STOP_REQUESTED = False
FORCE_EXIT = False
_SIGINT_COUNT = 0


def _on_sigint(signum, frame) -> None:  # noqa: ARG001
    global STOP_REQUESTED, FORCE_EXIT, _SIGINT_COUNT
    _SIGINT_COUNT += 1
    if _SIGINT_COUNT == 1:
        STOP_REQUESTED = True
        print("\n[INFO] Zatrzymanie żądane (Ctrl+C). Dokończę bieżące operacje i zakończę.")
    else:
        FORCE_EXIT = True
        print("\n[INFO] Wymuszam natychmiastowe zakończenie (drugi Ctrl+C).")


def _console() -> "Console | None":
    if _USE_RICH:
        return Console()
    return None


def _print(msg: str) -> None:
    con = _console()
    if con:
        con.print(msg)
    else:
        print(msg)


def _panel(title: str, body: str) -> None:
    con = _console()
    if con:
        con.print(Panel(body, title=title))
    else:
        print(f"=== {title} ===\n{body}\n")


def _ensure_dirs() -> None:
    PIC_MAX_DIR.mkdir(parents=True, exist_ok=True)
    MOCKUP_DIR.mkdir(parents=True, exist_ok=True)


def _pick_input_txt() -> Path:
    txts = [p for p in SCRIPT_DIR.glob(TXT_GLOB) if p.is_file() and not p.name.startswith(".")]
    if not txts:
        raise FileNotFoundError(f"Nie znalazłem żadnego pliku TXT w folderze: {SCRIPT_DIR}")
    if len(txts) == 1:
        return txts[0]
    txts.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return txts[0]


def _sanitize_id(s: str) -> str:
    return re.sub(r"[^0-9A-Za-z_\-]+", "_", s.strip())


def _is_tidal(url: str) -> bool:
    try:
        u = urlparse(url)
        return u.netloc.lower() == "resources.tidal.com" and u.path.startswith("/images/")
    except Exception:
        return False


def _set_size_in_url(url: str, target: str) -> str:
    return re.sub(r"/\d{2,4}x\d{2,4}(?=\.[A-Za-z0-9]+$)", f"/{target}", url)


def _mini_url(url: str) -> str:
    if _is_tidal(url) and "160x160" in url:
        return url.replace("160x160", "320x320")
    return url


def _max_url(url: str) -> str:
    if _is_tidal(url):
        u2 = _set_size_in_url(url, "1280x1280")
        if u2 == url and "320x320" in url:
            u2 = url.replace("320x320", "1280x1280")
        if u2 == url and "160x160" in url:
            u2 = url.replace("160x160", "1280x1280")
        return u2
    return url


def _parse_txt_lines(txt_path: Path) -> List[Tuple[str, str]]:
    rows: List[Tuple[str, str]] = []
    lines = txt_path.read_text(encoding="utf-8", errors="replace").splitlines()
    for i, raw in enumerate(lines, start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = re.split(r"\s*-\s*", line, maxsplit=1)
        if len(parts) != 2:
            _print(f"[WARN] Pomijam linię {i} (zły format): {raw}")
            continue
        album_id = parts[0].strip()
        link = parts[1].strip()
        if not album_id or not link:
            _print(f"[WARN] Pomijam linię {i} (puste ID lub link): {raw}")
            continue
        rows.append((album_id, link))
    if not rows:
        raise ValueError(f"Plik TXT nie zawiera poprawnych linii w formacie 'ID - LINK': {txt_path.name}")
    return rows


@dataclass(frozen=True)
class Job:
    kind: str  # "mini" | "max"
    album_id: str
    url: str
    out_path: Path


async def _fetch_bytes(session: "aiohttp.ClientSession", url: str) -> bytes:
    last_err: Optional[BaseException] = None
    for attempt in range(1, RETRIES + 1):
        if FORCE_EXIT:
            raise asyncio.CancelledError()
        try:
            async with session.get(url) as resp:
                if resp.status == 404:
                    raise FileNotFoundError("404 Not Found")
                resp.raise_for_status()
                return await resp.read()
        except Exception as e:  # noqa: BLE001
            last_err = e
            if attempt < RETRIES:
                await asyncio.sleep(0.6 * attempt)
            else:
                break
    assert last_err is not None
    raise last_err


def _atomic_write_bytes(dest: Path, data: bytes) -> None:
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(data)
    os.replace(tmp, dest)


async def _run_job(job: Job, session: "aiohttp.ClientSession", sem: asyncio.Semaphore) -> Tuple[str, str]:
    if FORCE_EXIT:
        return ("fail", "force-exit")
    if not DOWNLOAD_OVERWRITE and job.out_path.exists():
        return ("skip", f"{job.kind} {job.album_id} (exists)")
    async with sem:
        if STOP_REQUESTED:
            return ("skip", f"{job.kind} {job.album_id} (stop requested)")
        try:
            data = await _fetch_bytes(session, job.url)
            job.out_path.parent.mkdir(parents=True, exist_ok=True)
            _atomic_write_bytes(job.out_path, data)
            return ("ok", f"{job.kind} {job.album_id}")
        except asyncio.CancelledError:
            return ("fail", f"{job.kind} {job.album_id} (cancelled)")
        except Exception as e:  # noqa: BLE001
            return ("fail", f"{job.kind} {job.album_id}: {e}")


async def download_all(rows: List[Tuple[str, str]]) -> Tuple[int, int, int, List[str]]:
    _ensure_dirs()

    jobs: List[Job] = []
    for album_id_raw, link in rows:
        album_id = _sanitize_id(album_id_raw)
        maxi = _max_url(link)
        jobs.append(Job("max", album_id, maxi, PIC_MAX_DIR / f"max_{album_id}.jpg"))

    ok = skip = fail = 0
    fails: List[str] = []

    timeout = aiohttp.ClientTimeout(total=TIMEOUT_SEC)
    headers = {"User-Agent": "Mozilla/5.0 (CD-pipeline)"}
    sem = asyncio.Semaphore(CONCURRENCY)

    con = _console()
    async with aiohttp.ClientSession(timeout=timeout, headers=headers) as session:
        if _USE_RICH and con:
            progress = Progress(
                SpinnerColumn(),
                TextColumn("[bold]Pobieranie[/bold]"),
                BarColumn(),
                TextColumn("{task.completed}/{task.total}"),
                TimeElapsedColumn(),
                TimeRemainingColumn(),
                console=con,
            )
            with progress:
                task_id = progress.add_task("download", total=len(jobs))
                pending: set[asyncio.Task] = set()
                it = iter(jobs)
                max_inflight = max(4, CONCURRENCY * 2)

                def can_schedule() -> bool:
                    return not FORCE_EXIT and not STOP_REQUESTED

                while True:
                    if FORCE_EXIT:
                        for t in pending:
                            t.cancel()
                        break

                    while len(pending) < max_inflight and can_schedule():
                        try:
                            job = next(it)
                        except StopIteration:
                            break
                        pending.add(asyncio.create_task(_run_job(job, session, sem)))

                    if not pending:
                        break

                    done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                    for t in done:
                        status, msg = await t
                        if status == "ok":
                            ok += 1
                        elif status == "skip":
                            skip += 1
                        else:
                            fail += 1
                            fails.append(msg)
                        progress.advance(task_id, 1)

                if pending and not FORCE_EXIT:
                    done2, _ = await asyncio.wait(pending)
                    for t in done2:
                        status, msg = await t
                        if status == "ok":
                            ok += 1
                        elif status == "skip":
                            skip += 1
                        else:
                            fail += 1
                            fails.append(msg)
                        progress.advance(task_id, 1)
        else:
            # bez rich
            for idx, job in enumerate(jobs, start=1):
                if FORCE_EXIT:
                    break
                if STOP_REQUESTED:
                    skip += 1
                    continue
                status, msg = await _run_job(job, session, sem)
                if status == "ok":
                    ok += 1
                elif status == "skip":
                    skip += 1
                else:
                    fail += 1
                    fails.append(msg)
                if idx % 10 == 0 or idx == len(jobs):
                    _print(f"[INFO] Pobieranie: {idx}/{len(jobs)} (ok={ok}, skip={skip}, fail={fail})")

    return ok, skip, fail, fails


def _load_templates() -> Tuple[Image.Image, Image.Image]:
    if not TEMPLATE_DIR.exists():
        raise FileNotFoundError(f"Brak folderu template: {TEMPLATE_DIR}")
    if not BASE_FILE.exists():
        raise FileNotFoundError(f"Brak pliku bazy: {BASE_FILE.name} w {TEMPLATE_DIR}")
    if not REFL_FILE.exists():
        raise FileNotFoundError(f"Brak pliku reflections: {REFL_FILE.name} w {TEMPLATE_DIR}")

    base = Image.open(BASE_FILE).convert("RGBA")
    refl = Image.open(REFL_FILE).convert("RGBA")
    if refl.size != base.size:
        refl = refl.resize(base.size, Image.Resampling.LANCZOS)
    return base, refl


def _iter_covers() -> List[Path]:
    if not PIC_MAX_DIR.exists():
        return []
    covers = [p for p in PIC_MAX_DIR.iterdir() if p.is_file() and p.suffix.lower() in IMG_EXTS]
    covers.sort(key=lambda p: p.name.lower())
    return covers


def _save_composite(img_rgba: Image.Image, out_stem_path: Path) -> None:
    out_stem_path.parent.mkdir(parents=True, exist_ok=True)

    # Finalny mockup zapisujemy pomniejszony (np. 1484x1348 -> 371x337 przy DOWNSCALE=4)
    if MOCKUP_DOWNSCALE and MOCKUP_DOWNSCALE > 1:
        w, h = img_rgba.size
        new_w = max(1, w // MOCKUP_DOWNSCALE)
        new_h = max(1, h // MOCKUP_DOWNSCALE)
        img_rgba = img_rgba.resize((new_w, new_h), Image.Resampling.LANCZOS)

    rgb = img_rgba.convert("RGB")
    tmp = out_stem_path.with_suffix(".jpg.part")
    rgb.save(tmp, format="JPEG", quality=JPG_QUALITY, optimize=True)
    final = out_stem_path.with_suffix(".jpg")
    os.replace(tmp, final)


def generate_mockups() -> Tuple[int, int, List[str]]:
    base, refl = _load_templates()
    covers = _iter_covers()

    if not covers:
        _print(f"[WARN] Brak obrazów do przerobienia w: {PIC_MAX_DIR}")
        return 0, 0, []

    ok = fail = 0
    fails: List[str] = []

    con = _console()
    if _USE_RICH and con:
        progress = Progress(
            SpinnerColumn(),
            TextColumn("[bold]Mockupy[/bold]"),
            BarColumn(),
            TextColumn("{task.completed}/{task.total}"),
            TimeElapsedColumn(),
            TimeRemainingColumn(),
            console=con,
        )
        with progress:
            task_id = progress.add_task("mockups", total=len(covers))
            for cover_path in covers:
                if FORCE_EXIT or STOP_REQUESTED:
                    break
                try:
                    cover = Image.open(cover_path).convert("RGBA")
                    if SIDE and SIDE > 0:
                        cover = cover.resize((SIDE, SIDE), Image.Resampling.LANCZOS)

                    canvas = base.copy()
                    canvas.alpha_composite(cover, (PASTE_X, PASTE_Y))
                    canvas.alpha_composite(refl, (0, 0))

                    stem = cover_path.stem
                    album_id = stem
                    if stem.startswith("max_"):
                        album_id = stem[4:]
                    elif stem.startswith("mini_"):
                        album_id = stem[5:]
                    out_name = f"mini_{album_id}"
                    _save_composite(canvas, MOCKUP_DIR / out_name)
                    ok += 1
                except Exception as e:  # noqa: BLE001
                    fail += 1
                    fails.append(f"{cover_path.name}: {e}")
                progress.advance(task_id, 1)
    else:
        for idx, cover_path in enumerate(covers, start=1):
            if FORCE_EXIT or STOP_REQUESTED:
                break
            try:
                cover = Image.open(cover_path).convert("RGBA")
                if SIDE and SIDE > 0:
                    cover = cover.resize((SIDE, SIDE), Image.Resampling.LANCZOS)

                canvas = base.copy()
                canvas.alpha_composite(cover, (PASTE_X, PASTE_Y))
                canvas.alpha_composite(refl, (0, 0))

                stem = cover_path.stem
                album_id = stem
                if stem.startswith("max_"):
                    album_id = stem[4:]
                elif stem.startswith("mini_"):
                    album_id = stem[5:]
                out_name = f"mini_{album_id}"
                _save_composite(canvas, MOCKUP_DIR / out_name)
                ok += 1
            except Exception as e:  # noqa: BLE001
                fail += 1
                fails.append(f"{cover_path.name}: {e}")
            if idx % 10 == 0 or idx == len(covers):
                _print(f"[INFO] Mockupy: {idx}/{len(covers)} (ok={ok}, fail={fail})")

    return ok, fail, fails


def main() -> int:
    signal.signal(signal.SIGINT, _on_sigint)

    _panel(
        "CD PIPELINE",
        "\n".join(
            [
                f"Folder skryptu: {SCRIPT_DIR}",
                f"Wejście TXT:      auto (najświeższy {TXT_GLOB})",
                f"MAX  ->           {PIC_MAX_DIR.name}        (TIDAL →1280)",
                f"Template:         {TEMPLATE_DIR.name}/{BASE_FILE.name} + {REFL_FILE.name}",
                f"Mockupy ->        {MOCKUP_DIR.name}         (z {PIC_MAX_DIR.name}, /{MOCKUP_DOWNSCALE}, quality={JPG_QUALITY}, X={PASTE_X}, Y={PASTE_Y}, SIDE={SIDE})",
                "Zatrzymanie:      Ctrl+C (łagodnie), Ctrl+C drugi raz (natychmiast)",
            ]
        ),
    )

    try:
        txt_path = _pick_input_txt()
    except Exception as e:  # noqa: BLE001
        _print(f"[STOP] {e}")
        return 2

    _print(f"[INFO] Używam pliku TXT: {txt_path.name}")

    try:
        rows = _parse_txt_lines(txt_path)
    except Exception as e:  # noqa: BLE001
        _print(f"[STOP] {e}")
        return 2

    _print(f"[INFO] Rekordów w TXT: {len(rows)} (pobieram wszystkie)")

    try:
        ok, skip, fail, fails = asyncio.run(download_all(rows))
    except Exception as e:  # noqa: BLE001
        _print(f"[STOP] Downloader padł: {e}")
        return 1

    _panel("Podsumowanie pobierania", f"OK: {ok}\nPominięte: {skip}\nBłędy: {fail}")
    if fails:
        _panel("Błędy (pierwsze 12)", "\n".join(fails[:12]))

    if FORCE_EXIT or STOP_REQUESTED:
        _print("[INFO] Zatrzymano przed generowaniem mockupów.")
        return 130

    try:
        ok2, fail2, fails2 = generate_mockups()
    except Exception as e:  # noqa: BLE001
        _print(f"[STOP] Generator padł: {e}")
        return 1

    _panel("Podsumowanie mockupów", f"OK: {ok2}\nBłędy: {fail2}\nWyjście: {MOCKUP_DIR}")
    if fails2:
        _panel("Błędy (pierwsze 12)", "\n".join(fails2[:12]))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
