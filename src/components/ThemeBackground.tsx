import { isBlinkDesktopShell } from '../desktop/detect'

/** Slide atmosphere: logo blue/cyan wash left, logo mint wash right. */
export function ThemeBackground() {
  if (isBlinkDesktopShell()) {
    return <div className="theme-bg theme-bg-lite" aria-hidden="true" />
  }

  return (
    <div className="theme-bg" aria-hidden="true">
      <svg className="theme-bg-waves" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="waveBlueA" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
            <stop offset="45%" stopColor="#06b6d4" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.04" />
          </linearGradient>
          <linearGradient id="waveBlueB" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#1d4ed8" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="waveMintA" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.34" />
            <stop offset="50%" stopColor="#06b6d4" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0.04" />
          </linearGradient>
          <linearGradient id="waveMintB" x1="1" y1="0.2" x2="0.2" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#6ee7b7" stopOpacity="0.08" />
          </linearGradient>
          <filter id="waveSoft" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="18" />
          </filter>
          <filter id="waveSofter" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="28" />
          </filter>
        </defs>

        <g filter="url(#waveSofter)">
          <path
            fill="url(#waveBlueA)"
            d="M-80 620 C 180 540, 360 700, 560 640 C 740 580, 820 760, 640 820 C 360 900, 80 840, -80 740 Z"
          />
        </g>
        <g filter="url(#waveSoft)">
          <path
            fill="url(#waveBlueB)"
            d="M-40 700 C 220 650, 420 780, 620 730 C 800 690, 760 860, 480 900 C 160 940, -20 820, -40 700 Z"
          />
        </g>

        <g filter="url(#waveSofter)">
          <path
            fill="url(#waveMintA)"
            d="M1540 200 C 1280 160, 1180 340, 1020 300 C 820 250, 780 480, 980 560 C 1220 660, 1480 580, 1560 360 Z"
          />
        </g>
        <g filter="url(#waveSoft)">
          <path
            fill="url(#waveMintB)"
            d="M1480 520 C 1180 470, 980 640, 860 600 C 700 550, 760 780, 1040 840 C 1280 890, 1520 760, 1540 560 Z"
          />
        </g>
      </svg>
      <div className="theme-bg-dots" />
      <div className="theme-bg-grain" />
    </div>
  )
}
