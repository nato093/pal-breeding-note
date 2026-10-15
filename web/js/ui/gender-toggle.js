// 登録のモーダルの親の性別（任意。register-dialog の F017・D-15）。♂・♀・指定なし の押しボタン（ui/segmented.js の radiogroup）。
import { segmented } from './segmented.js';

const CHOICES = Object.freeze([
  ['M', '♂', 'オス'],
  ['F', '♀', 'メス'],
  ['', '指定なし', '性別を記録しない'],
]);

/**
 * @param {{ label: string, value?: string, onChange?: (value: string) => void }} options label は読み上げの名前（「親1の性別」など）
 * @returns {{ element: HTMLElement, getValue(): string, setValue(value: string): void, destroy(): void }}
 *   setValue は外からの反映（onChange は呼ばない）。値は 'M'・'F'・''（ほかは ''）
 */
export function genderToggle({ label, value = '', onChange = () => {} }) {
  const clean = (next) => (next === 'M' || next === 'F' ? next : '');
  let current = clean(value);
  const control = segmented({ label, choices: CHOICES, value: current, onChange: (next) => { current = clean(next); onChange(current); } });
  control.element.classList.add('gender-toggle');
  return {
    element: control.element,
    getValue: () => current,
    setValue(next) {
      current = clean(next);
      control.update(current);
    },
    destroy: () => control.destroy(),
  };
}
