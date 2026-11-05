/** 기능 구현 전 화면 자리표시 */
export function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <section className="placeholder" aria-labelledby="placeholder-title">
      <h2 id="placeholder-title">{title}</h2>
      <p>{description}</p>
    </section>
  );
}
