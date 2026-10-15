/**
 * Kalıcı oyuncu ayarları (localStorage). Tüm erişimler try/catch içinde:
 * gizli pencere / engellenmiş depolama durumunda varsayılanlarla çalışır.
 *
 *   loadSettings()            → { sensitivity, invertY, fov, masterVolume, musicVolume, quality, headBob }
 *   saveSettings(settings)
 *
 * `quality` null ise kullanıcı hiç seçmemiştir (main.js'in varsayılanı geçerli kalır).
 */
const KEY = 'azim.ayarlar.v1';

export const DEFAULT_SETTINGS = Object.freeze({
  /** Fare hassasiyeti çarpanı (1 = PlayerController varsayılanı) */
  sensitivity: 1,
  invertY: false,
  /** Temel görüş alanı (derece) */
  fov: 75,
  masterVolume: 0.8,
  musicVolume: 0.6,
  /** 'low' | 'medium' | 'high' | null */
  quality: null,
  headBob: true,
});

/** PlayerController'ın varsayılan hassasiyeti (radyan / piksel) */
export const BASE_SENSITIVITY = 0.0022;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function sanitize(raw) {
  const s = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return s;
  if (Number.isFinite(raw.sensitivity)) s.sensitivity = clamp(raw.sensitivity, 0.2, 3);
  if (typeof raw.invertY === 'boolean') s.invertY = raw.invertY;
  if (Number.isFinite(raw.fov)) s.fov = clamp(Math.round(raw.fov), 55, 100);
  if (Number.isFinite(raw.masterVolume)) s.masterVolume = clamp(raw.masterVolume, 0, 1);
  if (Number.isFinite(raw.musicVolume)) s.musicVolume = clamp(raw.musicVolume, 0, 1);
  if (['low', 'medium', 'high'].includes(raw.quality)) s.quality = raw.quality;
  if (typeof raw.headBob === 'boolean') s.headBob = raw.headBob;
  return s;
}

export function loadSettings() {
  try {
    const txt = window.localStorage?.getItem(KEY);
    return sanitize(txt ? JSON.parse(txt) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    window.localStorage?.setItem(KEY, JSON.stringify(sanitize(settings)));
  } catch {
    /* depolama yok — sessizce geç */
  }
}
