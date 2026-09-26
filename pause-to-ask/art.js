// Artwork for the tour: the made-up ceramics studio's photos, drawn as SVG.
// One sprite of <symbol>s, referenced with <use>, so the five copies of the
// studio's site on the tour (three breakpoints, the preview and the live site)
// share one set of shapes. Gradients live at the sprite's root: a sprite
// hidden with display:none would switch them off in Chromium.

export const IMAGES = {
  arch: 'Arch study',
  vessels: 'Vessels on clay',
  glaze: 'Glaze tiles',
  kiln: 'Kiln glow',
};

export const SPRITE = `
<svg class="art-sprite" aria-hidden="true" focusable="false" width="0" height="0">
  <defs>
    <linearGradient id="g-arch-ball" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#F7F3EE"/><stop offset=".55" stop-color="#E2D9CE"/><stop offset="1" stop-color="#C7BBAC"/>
    </linearGradient>
    <linearGradient id="g-arch-wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#E9E3DA"/><stop offset="1" stop-color="#DCD3C7"/>
    </linearGradient>
    <linearGradient id="g-clay" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#D2743F"/><stop offset=".72" stop-color="#BE5C2C"/><stop offset=".72" stop-color="#A94D22"/><stop offset="1" stop-color="#963F1B"/>
    </linearGradient>
    <linearGradient id="g-vase" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#FBF4EA"/><stop offset=".45" stop-color="#EFE4D5"/><stop offset="1" stop-color="#C9B59C"/>
    </linearGradient>
    <linearGradient id="g-bowl" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4A3A33"/><stop offset=".5" stop-color="#2A201C"/><stop offset="1" stop-color="#1B1411"/>
    </linearGradient>
    <linearGradient id="g-cup" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#F3ECE2"/><stop offset="1" stop-color="#CDBEAA"/>
    </linearGradient>
    <linearGradient id="g-teal" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5E8C84"/><stop offset="1" stop-color="#2F5A55"/>
    </linearGradient>
    <linearGradient id="g-glaze-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3A6B66"/><stop offset="1" stop-color="#244B47"/>
    </linearGradient>
    <radialGradient id="g-kiln" cx=".5" cy=".62" r=".55">
      <stop offset="0" stop-color="#FFE3A6"/><stop offset=".3" stop-color="#FF9B3D"/><stop offset=".7" stop-color="#B23E16"/><stop offset="1" stop-color="#3A1A0F"/>
    </radialGradient>
    <linearGradient id="g-fire" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#FFB25B"/><stop offset=".6" stop-color="#F0662A"/><stop offset="1" stop-color="#F0662A" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="g-wood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#261711"/><stop offset="1" stop-color="#6E2A10"/>
    </linearGradient>
    <radialGradient id="g-wheel" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#9A6848"/><stop offset="1" stop-color="#7A4C31"/>
    </radialGradient>
  </defs>

  <!-- The template's placeholder photo: plaster shapes in soft light. -->
  <symbol id="lm-arch" viewBox="0 0 600 640">
    <rect width="600" height="640" fill="url(#g-arch-wall)"/>
    <path d="M140 640V318a160 160 0 0 1 320 0v322z" fill="#D5CBBE"/>
    <path d="M140 640V318a160 160 0 0 1 12-61v383z" fill="#CBC0B2"/>
    <rect x="96" y="520" width="248" height="120" fill="#CEC4B6"/>
    <rect x="96" y="520" width="248" height="6" fill="#DDD5CA"/>
    <ellipse cx="400" cy="592" rx="118" ry="16" fill="#B9AD9D" opacity=".5"/>
    <circle cx="392" cy="506" r="86" fill="url(#g-arch-ball)"/>
  </symbol>

  <!-- Loam's hero: a vase, a dark bowl and a dipped cup on terracotta. -->
  <symbol id="lm-vessels" viewBox="0 0 600 640">
    <rect width="600" height="640" fill="url(#g-clay)"/>
    <ellipse cx="300" cy="566" rx="150" ry="20" fill="#7C3515" opacity=".45"/>
    <path d="M262 120h76c-2 10-10 16-14 22-6 12 0 40 26 64 42 38 88 84 88 170 0 88-52 150-82 176l-4 10h-112l-4-10c-30-26-82-88-82-176 0-86 46-132 88-170 26-24 32-52 26-64-4-6-12-12-14-22z" fill="url(#g-vase)"/>
    <path d="M262 120h76v8h-76z" fill="#FFFFFF" opacity=".5"/>
    <path d="M232 262c-24 30-38 64-38 112 0 70 34 122 58 148" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round" fill="none" opacity=".38"/>
    <ellipse cx="470" cy="582" rx="86" ry="12" fill="#7C3515" opacity=".5"/>
    <path d="M394 520h152c-4 36-36 62-76 62s-72-26-76-62z" fill="url(#g-bowl)"/>
    <ellipse cx="470" cy="520" rx="76" ry="11" fill="#5C4A41"/>
    <ellipse cx="470" cy="521" rx="66" ry="7" fill="#1A1210"/>
    <ellipse cx="128" cy="590" rx="58" ry="9" fill="#7C3515" opacity=".5"/>
    <path d="M84 486h88v96c0 6-4 10-10 10h-68c-6 0-10-4-10-10z" fill="url(#g-cup)"/>
    <path d="M84 486h88v34c-10 8-18-2-26 6s-16 4-22-2-14 6-22 0-12-4-18 0z" fill="url(#g-teal)"/>
    <ellipse cx="128" cy="486" rx="44" ry="7" fill="#24413D"/>
  </symbol>

  <!-- An asset the tour doesn't pick: glaze test tiles. -->
  <symbol id="lm-glaze" viewBox="0 0 600 640">
    <rect width="600" height="640" fill="url(#g-glaze-bg)"/>
    <g transform="translate(96 124)">
      <rect width="120" height="120" rx="14" fill="#A8C4AE"/><rect x="144" width="120" height="120" rx="14" fill="#3B2A22"/><rect x="288" width="120" height="120" rx="14" fill="#EADAC4"/>
      <rect y="144" width="120" height="120" rx="14" fill="#2C4E7E"/><rect x="144" y="144" width="120" height="120" rx="14" fill="#C2B89F"/><rect x="288" y="144" width="120" height="120" rx="14" fill="#A5552D"/>
      <rect y="288" width="120" height="120" rx="14" fill="#D9C27A"/><rect x="144" y="288" width="120" height="120" rx="14" fill="#6F8F6B"/><rect x="288" y="288" width="120" height="120" rx="14" fill="#F2EEE8"/>
    </g>
  </symbol>

  <!-- Another asset: the kiln's glow. -->
  <symbol id="lm-kiln" viewBox="0 0 600 640">
    <rect width="600" height="640" fill="#241813"/>
    <path d="M110 640V330a190 190 0 0 1 380 0v310z" fill="url(#g-kiln)"/>
    <path d="M110 640V330a190 190 0 0 1 380 0v310" stroke="#3E2A20" stroke-width="26" fill="none"/>
    <path d="M200 640v-96c0-14 12-22 30-22s30 8 30 22v96zM300 640v-150c0-18 16-28 38-28s38 10 38 28v150z" fill="#2B1710" opacity=".85"/>
  </symbol>

  <!-- Journal covers -->
  <symbol id="lm-j1" viewBox="0 0 400 300">
    <rect width="400" height="300" fill="#EFE6DA"/>
    <g transform="translate(48 58)">
      <circle cx="26" cy="26" r="24" fill="#A8C4AE"/><circle cx="110" cy="26" r="24" fill="#3B2A22"/><circle cx="194" cy="26" r="24" fill="#D9C27A"/><circle cx="278" cy="26" r="24" fill="#2C4E7E"/>
      <circle cx="26" cy="92" r="24" fill="#A5552D"/><circle cx="110" cy="92" r="24" fill="#C2B89F"/><circle cx="194" cy="92" r="24" fill="#6F8F6B"/><circle cx="278" cy="92" r="24" fill="#E4CFB3"/>
      <circle cx="26" cy="158" r="24" fill="#58403A"/><circle cx="110" cy="158" r="24" fill="#8FB3C4"/><circle cx="194" cy="158" r="24" fill="#C9793F"/><circle cx="278" cy="158" r="24" fill="#EDE6DD" stroke="#D9CFC2" stroke-width="2"/>
    </g>
  </symbol>
  <symbol id="lm-j2" viewBox="0 0 400 300">
    <rect width="400" height="300" fill="url(#g-wood)"/>
    <path d="M200 300c-60-40-70-96-30-150 10 40 30 44 40 20 18-44 6-88-12-120 70 40 106 122 72 196-8 18-30 40-70 54z" fill="url(#g-fire)"/>
    <path d="M124 300c-30-30-30-70-4-104 6 26 20 28 26 10 30 36 30 70-22 94z" fill="url(#g-fire)" opacity=".7"/>
    <path d="M286 300c-24-24-24-58 0-86 4 20 16 22 20 8 22 30 18 60-20 78z" fill="url(#g-fire)" opacity=".6"/>
    <circle cx="150" cy="96" r="3" fill="#FFB25B"/><circle cx="262" cy="70" r="2.5" fill="#FFB25B"/><circle cx="232" cy="120" r="2" fill="#FFD28A"/><circle cx="118" cy="140" r="2" fill="#FFD28A"/>
  </symbol>
  <symbol id="lm-j3" viewBox="0 0 400 300">
    <rect width="400" height="300" fill="#D8C2A4"/>
    <circle cx="200" cy="150" r="128" fill="url(#g-wheel)"/>
    <circle cx="200" cy="150" r="128" fill="none" stroke="#6A4029" stroke-width="3" opacity=".5"/>
    <circle cx="200" cy="150" r="76" fill="#EFE3D3"/>
    <circle cx="200" cy="150" r="56" fill="#E2D1BC"/>
    <path d="M200 102a48 48 0 1 1-44 30 38 38 0 1 1 44 50 26 26 0 1 1 18-40" fill="none" stroke="#C9B397" stroke-width="3" stroke-linecap="round"/>
  </symbol>
</svg>`;

/** An <svg> that shows one of the sprite's images, cropped like object-fit: cover. */
export function picture(id, className = '') {
  return `<svg class="${className}" viewBox="${id.startsWith('j') ? '0 0 400 300' : '0 0 600 640'}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><use href="#lm-${id}"/></svg>`;
}
