// site/src/lib/dish-card.mjs — one card-state contract for Homepage and Menu.
//
// The table can hold the same dish with more than one accompaniment. A radio group is only the choice
// for the next plate, so it cannot be the visual source of truth for the whole selection. This module
// paints the radio that represents the next addition, while a separate summary and per-side quantities
// keep every already-selected side visible.

export function dishSelection(table, id) {
  const options = [];
  let qty = 0;
  for (const line of table.lines) {
    if (line.id !== id) continue;
    qty += line.qty;
    if (line.option) options.push({ option: line.option, qty: line.qty });
  }
  return { qty, options };
}

export function paintDishCard(card, selection) {
  const { qty, options } = selection;
  card.toggleAttribute("data-on", qty > 0);

  const button = card.querySelector("[data-add]");
  if (button) {
    button.textContent = qty > 0 ? `On your table · ${qty}` : "Add to table";
    button.setAttribute("aria-pressed", String(qty > 0));
  }

  const note = card.querySelector("[data-card-selection]");
  if (note) {
    note.hidden = options.length === 0;
    note.textContent = options.length
      ? `${qty} selected · ${options.map(({ option, qty: sideQty }) => `${option} × ${sideQty}`).join(" · ")}`
      : "";
  }

  const quantities = new Map(options.map(({ option, qty: sideQty }) => [option, sideQty]));
  const radios = card.querySelectorAll("input[type=radio]");
  for (const radio of radios) {
    const label = radio.closest(".acc__option");
    const sideQty = quantities.get(radio.value);
    if (sideQty !== undefined) {
      label?.setAttribute("data-selected", "");
      label?.setAttribute("data-side-qty", String(sideQty));
    } else {
      label?.removeAttribute("data-selected");
      label?.removeAttribute("data-side-qty");
    }
  }

  if (options.length === 1) {
    const selected = radios.find((radio) => radio.value === options[0].option) ?? radios[0];
    for (const radio of radios) radio.checked = radio === selected;
  } else if (options.length === 0) {
    // No stored choice means the first side is simply the default for the next plate.
    for (const radio of radios) radio.checked = radio === radios[0];
  } else if (radios.length && !radios.some((radio) => radio.checked)) {
    // Multiple selected sides do not map to one radio. Keep a usable next-addition choice rather than
    // clearing the group and making the Add button silently fall back to a side the guest cannot see.
    const next = radios.find((radio) => quantities.has(radio.value)) ?? radios[0];
    next.checked = true;
  }
}

export function wireDishCards(root, { target, event = "hh:table", getTable, addToTable }) {
  const cards = Array.from(root.querySelectorAll("[data-card]"));

  const paint = () => {
    const table = getTable();
    for (const card of cards) paintDishCard(card, dishSelection(table, card.dataset.id ?? ""));
  };

  const onClick = (event) => {
    const button = event.target?.closest?.("[data-add]");
    if (!button) return;
    const card = button.closest("[data-card]");
    if (!card) return;
    const choice = card.querySelector("[name^='acc-'][type='radio']:checked");
    addToTable(button.dataset.add ?? "", choice?.value);
    button.animate?.(
      [{ transform: "scale(1)" }, { transform: "scale(0.94)" }, { transform: "scale(1)" }],
      { duration: 260, easing: "cubic-bezier(0.2,1.24,0.32,1)" },
    );
  };

  target.addEventListener(event, paint);
  root.addEventListener("click", onClick);
  paint();

  return () => {
    target.removeEventListener(event, paint);
    root.removeEventListener("click", onClick);
  };
}
