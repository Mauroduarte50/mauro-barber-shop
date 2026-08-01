export function BrandFooter({ className = "" }: { className?: string }) {
  return (
    // pr-[70px] on mobile only clears the floating dark/light toggle button
    // (fixed bottom-4 right-4, ~60px footprint) so this centered watermark
    // line never sits underneath it, regardless of page length or scroll
    // position — removed again at sm+ where the button is far from the
    // text's horizontal extent.
    <p className={`text-center text-[11px] text-stone-500 dark:text-stone-400 pl-4 pr-[70px] sm:px-0 ${className}`}>
      Sistema de reservas por <span className="font-semibold tracking-widest">TURNOPLUS</span>
    </p>
  );
}
