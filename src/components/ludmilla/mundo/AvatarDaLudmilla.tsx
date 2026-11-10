/**
 * O avatar PROVISÓRIO da Ludmilla (o do mockup aprovado). A ilustração definitiva é a entrega 6
 * (spec §3): entra como arquivo do projeto, com o mesmo `aria-label`.
 */
export function AvatarDaLudmilla({ tamanho = 40, decorativo = false }: { tamanho?: number; decorativo?: boolean }) {
  return (
    <svg
      width={tamanho} height={tamanho} viewBox="0 0 56 56" className="shrink-0"
      {...(decorativo ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'Ludmilla' })}
    >
      <circle cx="28" cy="28" r="28" fill="#F2B705" />
      <path d="M15 28c0-10 6-17 13-17s13 7 13 17c0 5-1 9-3 12H18c-2-3-3-7-3-12z" fill="#0F3D4C" />
      <path d="M9 56c2-10 9-15 19-15s17 5 19 15z" fill="#0F3D4C" />
      <rect x="24.5" y="33" width="7" height="9" rx="3" fill="#C98E6B" />
      <ellipse cx="28" cy="27.5" rx="8.6" ry="10.2" fill="#D9A07C" />
      <path d="M19 25c1.5-7 6.5-10.5 11.5-10.5 4.5 0 7.5 3 8.5 7-5.5 0-10.5-1.2-13.5-4.2-1.8 3.2-3.8 5.8-6.5 7.7z" fill="#0F3D4C" />
      <circle cx="24.7" cy="28.3" r="1.15" fill="#0F3D4C" />
      <circle cx="31.3" cy="28.3" r="1.15" fill="#0F3D4C" />
      <path d="M25.3 32.6c1.6 1.2 3.8 1.2 5.4 0" stroke="#0F3D4C" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </svg>
  );
}
