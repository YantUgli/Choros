import { Button } from "../ds";
import { Modal } from "../Modal";
import { Label } from "../Label";

export function ConfirmModal({
  title,
  body,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} width={400} onClose={onClose}>
      <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <Label strong={false}>{body}</Label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm}>
            Oke
          </Button>
        </div>
      </div>
    </Modal>
  );
}
