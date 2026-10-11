// The fields of a client's data export (src/config/my-data.ts): each one's label and how its value reads.

/**
 * How a value reads. `time`: an instant, as India's date and clock. `day`: a date. `money`: paise, as rupees.
 * `yesNo`: 1 or 0. `words`: a stored code, as words ("first_fit" reads "First fit"). `purpose`: a consent's purpose.
 * `purposes`: a JSON list of them. `notice`: a notice's version, as the words it showed.
 */
type FieldKind = "text" | "time" | "day" | "money" | "yesNo" | "words" | "purpose" | "purposes" | "notice";

export interface Field {
  readonly label: string;
  readonly as: FieldKind;
}

export interface Part {
  readonly title: string;
  readonly fields: Readonly<Record<string, Field>>;
}

export const text = (label: string): Field => ({ label, as: "text" });
export const time = (label: string): Field => ({ label, as: "time" });
export const day = (label: string): Field => ({ label, as: "day" });
export const money = (label: string): Field => ({ label, as: "money" });
export const yesNo = (label: string): Field => ({ label, as: "yesNo" });
export const words = (label: string): Field => ({ label, as: "words" });
