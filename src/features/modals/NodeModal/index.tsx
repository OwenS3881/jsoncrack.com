import React from "react";
import type { ModalProps } from "@mantine/core";
import { Modal, Stack, Text, ScrollArea, Flex, CloseButton, Button, Textarea, Group, TextInput, NumberInput, Checkbox } from "@mantine/core";
import { CodeHighlight } from "@mantine/code-highlight";
import type { NodeData } from "../../../types/graph";
import useGraph from "../../editor/views/GraphView/stores/useGraph";
import useJson from "../../../store/useJson";
import useFile from "../../../store/useFile";

// return object from json removing array and object fields
const normalizeNodeData = (nodeRows: NodeData["text"]) => {
  if (!nodeRows || nodeRows.length === 0) return "{}";
  if (nodeRows.length === 1 && !nodeRows[0].key) return `${nodeRows[0].value}`;

  const obj = {};
  nodeRows?.forEach(row => {
    if (row.type !== "array" && row.type !== "object") {
      if (row.key) obj[row.key] = row.value;
    }
  });
  return JSON.stringify(obj, null, 2);
};

// return json path in the format $["customer"]
const jsonPathToString = (path?: NodeData["path"]) => {
  if (!path || path.length === 0) return "$";
  const segments = path.map(seg => (typeof seg === "number" ? seg : `"${seg}"`));
  return `$[${segments.join("][")}]`;
};

export const NodeModal = ({ opened, onClose }: ModalProps) => {
  const nodeData = useGraph(state => state.selectedNode);
  const setJson = useJson(state => state.setJson);
  const getJson = useJson(state => state.getJson);
  const setContents = useFile(state => state.setContents);
  const setSelectedNode = useGraph(state => state.setSelectedNode);

  const [editing, setEditing] = React.useState(false);
  // store field values keyed by row key or special __root for single primitive
  const [fields, setFields] = React.useState<Record<string, any>>({});

  React.useEffect(() => {
    // initialize fields when node changes or modal opens
    const rows = nodeData?.text ?? [];
    const primitiveRows = rows.filter(r => r.type !== "array" && r.type !== "object");
    const initial: Record<string, any> = {};
    if (primitiveRows.length === 1 && !primitiveRows[0].key) {
      // single primitive value
      const v = primitiveRows[0].value;
      initial["__root"] = v ?? "";
    } else {
      primitiveRows.forEach(r => {
        if (r.key) initial[r.key] = r.value ?? "";
      });
    }
    setFields(initial);
    setEditing(false);
  }, [nodeData, opened]);

  const getAtPath = (root: any, path?: NodeData['path']) => {
    if (!path || path.length === 0) return root;
    let cur = root;
    for (let i = 0; i < path.length; i++) {
      if (cur == null) return undefined;
      cur = cur[path[i] as any];
    }
    return cur;
  };

  const setAtPath = (root: any, path: NodeData['path'] | undefined, value: any) => {
    // If no path, return merged or replaced root depending on types
    if (!path || path.length === 0) {
      if (root && typeof root === 'object' && !Array.isArray(root) && value && typeof value === 'object' && !Array.isArray(value)) {
        return { ...root, ...value };
      }
      return value;
    }

    // clone the whole root safely for JSON data
    const clonedRoot = root == null ? (typeof path[0] === 'number' ? [] : {}) : JSON.parse(JSON.stringify(root));
    let cur: any = clonedRoot;
    for (let i = 0; i < path.length; i++) {
      const seg = path[i];
      const isLast = i === path.length - 1;
      if (isLast) {
        const existing = cur[seg as any];
        // if both existing and value are plain objects, merge shallowly to preserve children
        if (existing && typeof existing === 'object' && !Array.isArray(existing) && value && typeof value === 'object' && !Array.isArray(value)) {
          cur[seg as any] = { ...existing, ...value };
        } else {
          cur[seg as any] = value;
        }
      } else {
        if (cur[seg as any] == null) {
          // create container depending on next segment type
          cur[seg as any] = typeof path[i + 1] === 'number' ? [] : {};
        }
        cur = cur[seg as any];
      }
    }
    return clonedRoot;
  };

  const handleSave = () => {
    try {
      // build parsed value from fields and nodeData rows (only primitive rows are editable)
      const rows = nodeData?.text ?? [];
      const primitiveRows = rows.filter(r => r.type !== "array" && r.type !== "object");

      let parsed: any;
      if (primitiveRows.length === 1 && !primitiveRows[0].key) {
        const row = primitiveRows[0];
        const raw = fields["__root"];
        if (row.type === "number") parsed = raw === "" || raw == null ? null : Number(raw);
        else if (row.type === "boolean") parsed = Boolean(raw);
        else if (row.type === "null") parsed = null;
        else parsed = raw;
      } else {
        // keyed fields -> object or array depending on keys
        const keys = primitiveRows.map(r => r.key).filter(Boolean) as string[];
        const allNumeric = keys.length > 0 && keys.every(k => /^\d+$/.test(k!));
        if (allNumeric) {
          // build array
          const indices = keys.map(k => Number(k));
          const maxIndex = Math.max(...indices);
          const arr = new Array(maxIndex + 1).fill(null);
          primitiveRows.forEach(r => {
            if (!r.key) return;
            const raw = fields[r.key];
            let v: any;
            if (r.type === "number") v = raw === "" || raw == null ? null : Number(raw);
            else if (r.type === "boolean") v = Boolean(raw);
            else if (r.type === "null") v = null;
            else v = raw;
            arr[Number(r.key)] = v;
          });
          parsed = arr;
        } else {
          const obj: Record<string, any> = {};
          primitiveRows.forEach(r => {
            if (!r.key) return;
            const raw = fields[r.key];
            let v: any;
            if (r.type === "number") v = raw === "" || raw == null ? null : Number(raw);
            else if (r.type === "boolean") v = Boolean(raw);
            else if (r.type === "null") v = null;
            else v = raw;
            obj[r.key] = v;
          });
          parsed = obj;
        }
      }

      const currentJson = getJson();
      const root = currentJson ? JSON.parse(currentJson) : undefined;
      const existingAtPath = getAtPath(root, nodeData?.path);
      const valueToSet = existingAtPath && typeof existingAtPath === 'object' && !Array.isArray(existingAtPath) && parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { ...existingAtPath, ...parsed }
        : parsed;
      const newRoot = setAtPath(root, nodeData?.path, valueToSet);
      const newJson = JSON.stringify(newRoot, null, 2);
      // update left JSON which will also re-build the graph
      setJson(newJson);
      // also update the left editor contents so the visual text editor stays in sync
      try {
        setContents({ contents: newJson, hasChanges: false, skipUpdate: true });
      } catch (err) {
        // ignore - best-effort to keep editor synced
      }
      // optimistically update selected node so user sees immediate change
      if (nodeData) {
        const updatedNode: NodeData = {
          ...nodeData,
          // replace text rows with a single representation matching parsed value
          text: Array.isArray(parsed)
            ? parsed.map((v, i) => ({ key: String(i), value: v, type: typeof v === 'object' ? 'object' : (typeof v === 'number' ? 'number' : 'string') }))
            : typeof parsed === 'object' && parsed !== null
            ? Object.keys(parsed).map(k => ({ key: k, value: parsed[k], type: typeof parsed[k] === 'object' ? 'object' : (typeof parsed[k] === 'number' ? 'number' : 'string') }))
            : [{ key: null, value: parsed, type: typeof parsed as any }],
        };
        setSelectedNode(updatedNode);
      }
      setEditing(false);
      onClose?.();
    } catch (e) {
      // basic feedback for invalid JSON
      // prefer UI notification; fallback to alert
      // eslint-disable-next-line no-console
      console.error('Failed to parse JSON for node save', e);
      // keep editing state so user can fix
      // eslint-disable-next-line no-alert
      alert('Invalid input. Please fix the values before saving.');
    }
  };

  const handleCancel = () => {
    // reset fields to original primitive values
    const rows = nodeData?.text ?? [];
    const primitiveRows = rows.filter(r => r.type !== "array" && r.type !== "object");
    const initial: Record<string, any> = {};
    if (primitiveRows.length === 1 && !primitiveRows[0].key) {
      initial["__root"] = primitiveRows[0].value ?? "";
    } else {
      primitiveRows.forEach(r => {
        if (r.key) initial[r.key] = r.value ?? "";
      });
    }
    setFields(initial);
    setEditing(false);
  };

  return (
    <Modal size="auto" opened={opened} onClose={onClose} centered withCloseButton={false}>
      <Stack pb="sm" gap="sm">
        <Stack gap="xs">
          <Flex justify="space-between" align="center">
            <Text fz="xs" fw={500}>
              Content
            </Text>
            <Group>
              {!editing && (
                <Button size="xs" variant="filled" color="blue" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              {editing && (
                <>
                  <Button size="xs" onClick={handleSave} color="green">
                    Save
                  </Button>
                  <Button size="xs" variant="filled" color="red" onClick={handleCancel}>
                    Cancel
                  </Button>
                </>
              )}
              <CloseButton onClick={onClose} />
            </Group>
          </Flex>
          <ScrollArea.Autosize mah={250} maw={600}>
            {!editing ? (
              <CodeHighlight
                code={normalizeNodeData(nodeData?.text ?? [])}
                miw={350}
                maw={600}
                language="json"
                withCopyButton
              />
            ) : (
              <Stack>
                {(() => {
                  const rows = nodeData?.text ?? [];
                  const primitiveRows = rows.filter(r => r.type !== "array" && r.type !== "object");
                  if (primitiveRows.length === 1 && !primitiveRows[0].key) {
                    const row = primitiveRows[0];
                    // single primitive
                    if (row.type === "number") {
                      return (
                        <NumberInput
                          value={fields["__root"] as number}
                          onChange={val => setFields(s => ({ ...s, __root: val }))}
                        />
                      );
                    }
                    if (row.type === "boolean") {
                      return (
                        <Checkbox
                          label={row.key ?? "value"}
                          checked={Boolean(fields["__root"])}
                          onChange={ev => setFields(s => ({ ...s, __root: ev.currentTarget.checked }))}
                        />
                      );
                    }
                    // string or null fallback to text input
                    return (
                      <TextInput
                        value={String(fields["__root"] ?? "")}
                        onChange={ev => setFields(s => ({ ...s, __root: ev.currentTarget.value }))}
                      />
                    );
                  }

                  // multiple keyed primitive fields (object-like)
                  return primitiveRows.map(row => {
                    const key = row.key ?? "";
                    if (row.type === "number") {
                      return (
                        <NumberInput
                          key={key}
                          label={key}
                          value={typeof fields[key] === "number" ? fields[key] : Number(fields[key])}
                          onChange={val => setFields(s => ({ ...s, [key]: val }))}
                        />
                      );
                    }
                    if (row.type === "boolean") {
                      return (
                        <Checkbox
                          key={key}
                          label={key}
                          checked={Boolean(fields[key])}
                          onChange={ev => setFields(s => ({ ...s, [key]: ev.currentTarget.checked }))}
                        />
                      );
                    }

                    return (
                      <TextInput
                        key={key}
                        label={key}
                        value={String(fields[key] ?? "")}
                        onChange={ev => setFields(s => ({ ...s, [key]: ev.currentTarget.value }))}
                      />
                    );
                  });
                })()}
              </Stack>
            )}
          </ScrollArea.Autosize>
        </Stack>
        <Text fz="xs" fw={500}>
          JSON Path
        </Text>
        <ScrollArea.Autosize maw={600}>
          <CodeHighlight
            code={jsonPathToString(nodeData?.path)}
            miw={350}
            mah={250}
            language="json"
            copyLabel="Copy to clipboard"
            copiedLabel="Copied to clipboard"
            withCopyButton
          />
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
};
