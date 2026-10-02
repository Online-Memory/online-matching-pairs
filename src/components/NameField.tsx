"use client";

type Props = { value: string; onChange: (name: string) => void; id: string };

export function NameField({ value, onChange, id }: Props) {
  return (
    <div className="field">
      <label htmlFor={id}>Your name</label>
      <input
        id={id}
        name="name"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={24}
        autoComplete="nickname"
        required
      />
    </div>
  );
}
