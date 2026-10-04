import styles from '../../styles/catalog/HeroVisual.module.css'

function HeroVisual() {
  return (
    <div className={styles.visual} aria-hidden="true">
      <div className={styles.particles}>
        <span className={`${styles.particle} ${styles.particleOne}`} />
        <span className={`${styles.particle} ${styles.particleTwo}`} />
        <span className={`${styles.particle} ${styles.particleThree}`} />
        <span className={`${styles.particle} ${styles.particleFour}`} />
        <span className={`${styles.particle} ${styles.particleFive}`} />
        <span className={`${styles.particle} ${styles.particleSix}`} />
        <span className={`${styles.particle} ${styles.particleSeven}`} />
        <span className={`${styles.particle} ${styles.particleEight}`} />
        <span className={`${styles.particle} ${styles.particleNine}`} />
        <span className={`${styles.particle} ${styles.particleTen}`} />
        <span className={`${styles.particle} ${styles.particleEleven}`} />
        <span className={`${styles.particle} ${styles.particleTwelve}`} />
        <span className={`${styles.particle} ${styles.particleThirteen}`} />
        <span className={`${styles.particle} ${styles.particleFourteen}`} />
        <span className={`${styles.particle} ${styles.particleFifteen}`} />
        <span className={`${styles.particle} ${styles.particleSixteen}`} />
      </div>

      <svg
        className={styles.canvas}
        viewBox="0 0 640 600"
        role="presentation"
        focusable="false"
      >
        <defs>
          <linearGradient id="hero-core-surface" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#0aa8ff" />
            <stop offset="0.48" stopColor="#214bea" />
            <stop offset="1" stopColor="#7c31df" />
          </linearGradient>
          <linearGradient id="hero-core-border" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#5bf7ff" />
            <stop offset="0.5" stopColor="#ffffff" />
            <stop offset="1" stopColor="#d86cff" />
          </linearGradient>
          <linearGradient id="hero-orbit-cyan" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#0ae8ff" stopOpacity="0.25" />
            <stop offset="0.48" stopColor="#22edff" />
            <stop offset="1" stopColor="#2b83ff" stopOpacity="0.45" />
          </linearGradient>
          <linearGradient id="hero-orbit-blue" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#278cff" stopOpacity="0.35" />
            <stop offset="0.56" stopColor="#466dff" />
            <stop offset="1" stopColor="#5ce9ff" stopOpacity="0.5" />
          </linearGradient>
          <linearGradient id="hero-orbit-violet" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#653eff" stopOpacity="0.38" />
            <stop offset="0.52" stopColor="#9046ff" />
            <stop offset="1" stopColor="#ef5bd6" stopOpacity="0.72" />
          </linearGradient>
          <linearGradient id="hero-capsule" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#0c1b43" stopOpacity="0.98" />
            <stop offset="1" stopColor="#07112f" stopOpacity="0.94" />
          </linearGradient>
          <radialGradient id="hero-system-glow">
            <stop offset="0" stopColor="#275cff" stopOpacity="0.2" />
            <stop offset="0.48" stopColor="#123695" stopOpacity="0.1" />
            <stop offset="1" stopColor="#07102c" stopOpacity="0" />
          </radialGradient>
          <filter id="hero-core-glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="hero-line-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="hero-node-glow" x="-160%" y="-160%" width="420%" height="420%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle className={styles.systemGlow} cx="330" cy="300" r="274" />
        <g className={styles.backgroundGrid}>
          <circle cx="330" cy="300" r="246" />
          <circle cx="330" cy="300" r="218" />
          <circle cx="330" cy="300" r="168" />
          <circle cx="330" cy="300" r="136" />
          <path d="M330 54v492M84 300h492M156 126l348 348M504 126 156 474" />
        </g>
        <g className={styles.secondaryRings}>
          <circle cx="330" cy="300" r="198" />
          <circle cx="330" cy="300" r="154" />
        </g>

        <g className={`${styles.orbitGroup} ${styles.orbitCyan}`}>
          <g transform="rotate(18 330 300)">
            <ellipse
              className={`${styles.orbitLine} ${styles.orbitLineCyan}`}
              cx="330"
              cy="300"
              rx="206"
              ry="86"
            />
            <circle
              className={`${styles.orbitNode} ${styles.nodeCyan}`}
              cx="124"
              cy="300"
              r="8"
            />
          </g>
        </g>

        <g className={`${styles.orbitGroup} ${styles.orbitBlue}`}>
          <g transform="rotate(-42 330 300)">
            <ellipse
              className={`${styles.orbitLine} ${styles.orbitLineBlue}`}
              cx="330"
              cy="300"
              rx="177"
              ry="121"
            />
            <circle
              className={`${styles.orbitNode} ${styles.nodeBlue}`}
              cx="507"
              cy="300"
              r="7"
            />
          </g>
        </g>

        <g className={`${styles.orbitGroup} ${styles.orbitViolet}`}>
          <g transform="rotate(67 330 300)">
            <ellipse
              className={`${styles.orbitLine} ${styles.orbitLineViolet}`}
              cx="330"
              cy="300"
              rx="211"
              ry="78"
            />
            <circle
              className={`${styles.orbitNode} ${styles.nodeViolet}`}
              cx="541"
              cy="300"
              r="8"
            />
          </g>
        </g>

        <g className={styles.connectors}>
          <path d="M238 132h28l34 38h18" />
          <circle cx="318" cy="170" r="3.5" />
          <path d="M430 241h-28l-25 22h-14" />
          <circle cx="363" cy="263" r="3.5" />
          <path d="M263 462h20l26-29h14" />
          <circle cx="323" cy="433" r="3.5" />
        </g>

        <g className={styles.core}>
          <rect className={styles.coreHalo} x="255" y="225" width="150" height="150" rx="42" />
          <rect className={styles.coreBack} x="264" y="234" width="132" height="132" rx="37" />
          <rect
            className={styles.coreSurface}
            x="271"
            y="241"
            width="118"
            height="118"
            rx="32"
          />
          <path className={styles.coreShine} d="M289 253h66c13 0 22 5 29 14" />
          <text className={styles.coreText} x="330" y="313" textAnchor="middle">
            CN
          </text>
        </g>

        <g className={`${styles.capsule} ${styles.capsuleHardware}`}>
          <g transform="translate(8 40)">
            <rect className={styles.capsuleSurface} width="230" height="92" rx="28" />
            <circle className={styles.iconDisc} cx="49" cy="46" r="30" />
            <g className={styles.iconGlyph} transform="translate(33 30)">
              <rect x="5" y="5" width="22" height="22" rx="3" />
              <rect x="10" y="10" width="12" height="12" rx="1" />
              <path d="M10 1v4m6-4v4m6-4v4m-12 22v4m6-4v4m6-4v4M1 10h4m-4 6h4m-4 6h4m22-12h4m-4 6h4m-4 6h4" />
            </g>
            <text className={styles.labelText} x="91" y="53">
              Hardware
            </text>
          </g>
        </g>

        <g className={`${styles.capsule} ${styles.capsuleGaming}`}>
          <g transform="translate(420 195)">
            <rect className={styles.capsuleSurface} width="212" height="92" rx="28" />
            <circle className={`${styles.iconDisc} ${styles.iconDiscViolet}`} cx="49" cy="46" r="30" />
            <g className={`${styles.iconGlyph} ${styles.iconGlyphViolet}`} transform="translate(29 28)">
              <path d="M11 9h18c5 0 8 4 9 9l2 9c1 5-5 8-8 4l-5-5H13l-5 5c-3 4-9 1-8-4l2-9c1-5 4-9 9-9Z" />
              <path d="M10 15v8m-4-4h8m16-2h.1m4 5h.1" />
            </g>
            <text className={styles.labelText} x="91" y="53">
              Gaming
            </text>
          </g>
        </g>

        <g className={`${styles.capsule} ${styles.capsuleConnectivity}`}>
          <g transform="translate(22 462)">
            <rect className={styles.capsuleSurface} width="260" height="92" rx="28" />
            <circle className={`${styles.iconDisc} ${styles.iconDiscCyan}`} cx="49" cy="46" r="30" />
            <g className={styles.iconGlyph} transform="translate(29 28)">
              <path d="M2 14c10-9 26-9 36 0M8 21c7-6 17-6 24 0M15 28c3-3 7-3 10 0" />
              <circle className={styles.wifiDot} cx="20" cy="34" r="2.5" />
            </g>
            <text className={styles.labelText} x="91" y="53">
              Conectividad
            </text>
          </g>
        </g>
      </svg>
    </div>
  )
}

export default HeroVisual
