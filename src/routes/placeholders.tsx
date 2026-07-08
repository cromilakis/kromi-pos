export function Placeholder({ title }: { title: string }) {
  return (
    <div className="p-8">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-2">Módulo en construcción (sub-proyecto ③).</p>
    </div>
  );
}
