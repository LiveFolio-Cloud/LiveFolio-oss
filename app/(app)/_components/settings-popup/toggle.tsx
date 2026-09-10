'use client';

/** Rounded switch used across the shell settings. Inline styles only —
 *  deterministic geometry that cannot be affected by class compilation. */
export function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      style={{
        position: 'relative',
        width: 36,
        height: 20,
        borderRadius: 999,
        flexShrink: 0,
        backgroundColor: checked ? 'var(--app-accent)' : 'rgba(15, 15, 13, 0.12)',
        transition: 'background-color 150ms ease',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: 2,
          width: 16,
          height: 16,
          borderRadius: 999,
          backgroundColor: '#ffffff',
          boxShadow: '0 1px 2px rgba(15, 15, 13, 0.25)',
          transform: checked ? 'translateX(16px)' : 'translateX(0)',
          transition: 'transform 150ms ease',
        }}
      />
    </button>
  );
}
