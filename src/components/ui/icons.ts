export type IconName =
  | 'image'
  | 'upload'
  | 'download'
  | 'eye'
  | 'eye-off'
  | 'close'
  | 'sun'
  | 'moon'
  | 'chevron'
  | 'check'
  | 'alert'
  | 'copy'
  | 'trash'
  | 'plus'
  | 'sliders'
  | 'zip'
  | 'rotate'
  | 'lock'
  | 'sparkles'

/**
 * 手绘 24×24 线性图标（stroke 继承 currentColor），避免额外图标依赖。
 * 仅存放静态可信的 SVG 片段，不做任何用户输入插值。
 */
export const ICONS: Record<IconName, string> = {
  image:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4.2 17.2l4.6-4.6 3.4 3.4L15 12.4l4.8 4.8"/>',
  upload: '<path d="M12 19V5"/><path d="M7 10l5-5 5 5"/><path d="M5 19h14"/>',
  download: '<path d="M12 5v14"/><path d="M7 14l5 5 5-5"/><path d="M5 19h14"/>',
  eye: '<path d="M2.8 12S6.5 5.8 12 5.8 21.2 12 21.2 12 17.5 18.2 12 18.2 2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.6"/>',
  'eye-off':
    '<path d="M4.2 7.4C3.3 8.6 2.8 12 2.8 12S6.5 18.2 12 18.2c1.7 0 3.2-.6 4.5-1.4"/><path d="M9.9 6.1A8.9 8.9 0 0112 5.8c5.5 0 9.2 6.2 9.2 6.2a17 17 0 01-2.4 3.2"/><path d="M4 4l16 16"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2"/><path d="M12 19.5v2"/><path d="M4.6 4.6l1.4 1.4"/><path d="M18 18l1.4 1.4"/><path d="M2.5 12h2"/><path d="M19.5 12h2"/><path d="M4.6 19.4L6 18"/><path d="M18 6l1.4-1.4"/>',
  moon: '<path d="M20.2 14.6A8.4 8.4 0 019.4 3.8 8.5 8.5 0 1020.2 14.6z"/>',
  chevron: '<path d="M6 9.5l6 6 6-6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 6.5"/>',
  alert: '<path d="M12 3.8L21 20H3z"/><path d="M12 9.5v4.6"/><circle cx="12" cy="17" r="0.9"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6.2A2.2 2.2 0 0013.3 4H6.2A2.2 2.2 0 004 6.2v7.1a2.2 2.2 0 002.2 2.2h2.3"/>',
  trash: '<path d="M4 7h16"/><path d="M9.5 7V4.8h5V7"/><path d="M6.2 7l.9 12.2h9.8L17.8 7"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  sliders:
    '<path d="M4 7h10"/><path d="M18 7h2"/><circle cx="16" cy="7" r="2"/><path d="M4 17h4"/><path d="M12 17h8"/><circle cx="10" cy="17" r="2"/>',
  zip: '<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><path d="M10.5 3.5v2"/><path d="M13.5 5.5v2"/><path d="M10.5 7.5v2"/><path d="M13.5 9.5v2"/><rect x="9.5" y="13" width="5" height="4.5" rx="1.2"/>',
  rotate: '<path d="M4.5 12a7.5 7.5 0 101.9-5"/><path d="M4 4.5V10h5.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/>',
  sparkles:
    '<path d="M12 3.5l1.6 4.4 4.4 1.6-4.4 1.6L12 15.5l-1.6-4.4L6 9.5l4.4-1.6z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
}
