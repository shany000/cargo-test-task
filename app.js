'use strict';

const app = document.getElementById('app');
const content = document.getElementById('content');
const bottomButton = document.getElementById('bottom-button');

const PENDING_KEY = 'zapravka.pendingFueling';
let pollTimer = null;
let polling = false;

function readPending() {
    try {
        return JSON.parse(localStorage.getItem(PENDING_KEY));
    } catch {
        return null;
    }
}

const state = {
    page: 'home',
    trip: null,
    location: null,
    stations: [],
    fuel: null,
    station: null,
    stationFuel: null,
    pump: null,
    liters: null,
    pending: readPending(),
    fueling: null,
    notice: '',
    pollError: '',
    loading: false,
    error: '',
    retry: null
};

const fuelNames = {
    diesel: 'Дизель',
    diesel_premium: 'Дизель премиум',
    diesel_winter: 'Дизель зимний',
    ai92: 'АИ-92',
    ai95: 'АИ-95',
    ai100: 'АИ-100',
    propane: 'Пропан'
};

const money = value => new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 2
}).format(value);

function savePending() {
    localStorage.setItem(PENDING_KEY, JSON.stringify(state.pending));
}

function clearPending() {
    state.pending = null;
    localStorage.removeItem(PENDING_KEY);
}

function restorePending() {
    if (state.pending?.selection) {
        Object.assign(state, state.pending.selection);
    }
}

function distance(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad;
    const dLon = (b.lon - a.lon) * rad;

    const x = Math.sin(dLat / 2) ** 2 +
        Math.cos(a.lat * rad) * Math.cos(b.lat * rad) *
        Math.sin(dLon / 2) ** 2;

    return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, x)));
}

function clone(templateId) {
    return document.getElementById(templateId).content.cloneNode(true);
}

function setField(element, name, value) {
    element.querySelector(`[data-field="${name}"]`).textContent = value;
}

function show(templateId) {
    content.replaceChildren(clone(templateId));
    return content;
}

function nearbyStations() {
    return state.stations
        .map(s => ({
            ...s,
            distance: distance(state.location, { lat: s.lat, lon: s.lon })
        }))
        .filter(s => s.distance <= 30);
}

function renderHome() {
    const t = state.trip;
    const screen = show('home-screen');

    const date = new Date(t.date + 'T00:00:00').toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long'
    });

    const percent = Math.min(100, Math.max(0, t.limitLeft / t.limitTotal * 100));

    setField(screen, 'date', date);
    setField(screen, 'route', `${t.from} → ${t.to}`);
    setField(screen, 'truck', `Тягач ${t.truck}`);
    setField(screen, 'limit-left', money(t.limitLeft));
    setField(screen, 'limit-total', money(t.limitTotal));

    screen.querySelector('[data-field="progress"]').style.width = `${percent}%`;
}

function renderFuels() {
    const screen = show('fuels-screen');
    const container = screen.querySelector('[data-list="fuels"]');
    const stations = nearbyStations();

    const options = Object.keys(fuelNames).map(code => {
        const available = stations.filter(s => s.prices[code] != null);

        return {
            code,
            name: fuelNames[code],
            count: available.length,
            price: available.length
                ? Math.min(...available.map(s => s.prices[code]))
                : null
        };
    }).filter(f => f.count);

    options.forEach(f => {
        const option = clone('fuel-option');

        setField(option, 'name', f.name);
        setField(option, 'details', `${f.count} АЗС в радиусе 30 км`);
        setField(option, 'price', `от ${money(f.price)}/л`);

        option.querySelector('[data-action="fuel"]').dataset.id = f.code;
        container.append(option);
    });

    setField(screen, 'empty', 'В радиусе 30 км нет доступного топлива.');
    screen.querySelector('[data-field="empty"]').hidden = !!options.length;
}

function renderStationCard(s, best = false) {
    const card = clone('station-card');
    card.firstElementChild.classList.toggle('best-price', best);

    setField(card, 'distance', `${s.distance.toFixed(1)} км по прямой`);
    setField(card, 'name', s.name);
    setField(card, 'address', s.address);
    setField(card, 'fuel-label', `${state.fuel.name} за литр`);
    setField(card, 'price', money(s.prices[state.fuel.code]));

    card.querySelector('[data-field="best-label"]').hidden = !best;
    card.querySelector('[data-action="station"]').dataset.id = s.id;

    return card;
}

function renderStations() {
    const screen = show('stations-screen');
    const container = screen.querySelector('[data-list="stations"]');

    setField(screen, 'fuel', state.fuel.name);

    const stations = nearbyStations()
        .filter(s => s.prices[state.fuel.code] != null);

    const best = stations.reduce(
        (result, s) =>
            !result || s.prices[state.fuel.code] < result.prices[state.fuel.code]
                ? s
                : result,
        null
    );

    if (best) container.append(renderStationCard(best, true));

    [
        { title: 'До 10 км', min: 0, max: 10 },
        { title: '10–20 км', min: 10, max: 20 },
        { title: '20–30 км', min: 20, max: 30 }
    ].forEach(group => {
        const items = stations
            .filter(s =>
                s.id !== best?.id &&
                (group.min === 0
                    ? s.distance <= group.max
                    : s.distance > group.min && s.distance <= group.max)
            )
            .sort((a, b) =>
                a.prices[state.fuel.code] - b.prices[state.fuel.code] ||
                a.distance - b.distance
            );

        if (!items.length) return;

        const section = clone('station-group');
        setField(section, 'title', group.title);

        const list = section.querySelector('[data-list="stations"]');
        items.forEach(s => list.append(renderStationCard(s)));

        container.append(section);
    });

    setField(screen, 'empty', 'Нет АЗС с выбранным топливом в радиусе 30 км.');
    screen.querySelector('[data-field="empty"]').hidden = !!stations.length;
}

function pumpName(number) {
    const letters = ['А', 'Б', 'В', 'Г'];

    if (state.station?.brand === 'Колесо' && letters[number - 1]) {
        return `Колонка ${letters[number - 1]} · № ${number}`;
    }

    return `Колонка № ${number}`;
}

function renderPumps() {
    const screen = show('pumps-screen');

    setField(screen, 'station', state.station.name);
    setField(screen, 'address', state.station.address);
    setField(screen, 'fuel', state.stationFuel.name);
    setField(screen, 'price', `${money(state.stationFuel.price)}/л`);

    const list = screen.querySelector('[data-list="pumps"]');
    let available = 0;

    const statuses = {
        free: 'Свободна',
        busy: 'Занята',
        off: 'Не работает'
    };

    state.station.pumps.forEach(p => {
        const option = clone('pump-option');
        const compatible = p.fuels.includes(state.fuel.code);
        const selectable = p.status === 'free' && compatible;

        if (selectable) available++;

        setField(option, 'name', pumpName(p.number));
        setField(
            option,
            'status',
            p.status === 'free' && !compatible
                ? 'Нет выбранного топлива'
                : statuses[p.status]
        );

        setField(
            option,
            'fuels',
            state.station.fuels
                .filter(f => p.fuels.includes(f.code))
                .map(f => f.name)
                .join(', ')
        );

        const button = option.querySelector('[data-action="pump"]');
        button.dataset.id = p.number;
        button.disabled = !selectable;

        list.append(option);
    });

    const note = state.notice ||
        (!available ? 'Нет свободных колонок с выбранным топливом.' : '');

    setField(screen, 'note', note);
    screen.querySelector('[data-field="note"]').hidden = !note;
}

function litersError() {
    if (!Number.isFinite(state.liters)) return 'Укажите количество литров.';

    if (state.liters < state.station.litersMin) {
        return `Минимальный объём — ${state.station.litersMin} л.`;
    }

    if (state.liters > state.station.litersMax) {
        return `Максимальный объём — ${state.station.litersMax} л.`;
    }

    if (state.liters * state.stationFuel.price > state.trip.limitLeft) {
        return 'Стоимость превышает доступный остаток лимита.';
    }

    return '';
}

function renderLiters() {
    const screen = show('liters-screen');

    state.liters ??= state.station.litersMin;

    setField(screen, 'station', state.station.name);
    setField(screen, 'fuel', state.stationFuel.name);
    setField(screen, 'pump', pumpName(state.pump.number));
    setField(screen, 'price', money(state.stationFuel.price));
    setField(screen, 'limits', `${state.station.litersMin}–${state.station.litersMax} л`);

    const input = screen.querySelector('[data-field="liters"]');
    input.min = state.station.litersMin;
    input.max = state.station.litersMax;
    input.value = state.liters ?? '';

    setField(
        screen,
        'total',
        Number.isFinite(state.liters)
            ? money(state.liters * state.stationFuel.price)
            : '—'
    );

    const warning = litersError() || state.notice;
    setField(screen, 'warning', warning);
    screen.querySelector('[data-field="warning"]').hidden = !warning;
}

function renderReview() {
    const screen = show('review-screen');

    setField(screen, 'station', state.station.name);
    setField(screen, 'fuel', state.stationFuel.name);
    setField(screen, 'pump', pumpName(state.pump.number));
    setField(screen, 'liters', `${state.liters} л`);
    setField(screen, 'price', `${money(state.stationFuel.price)}/л`);
    setField(screen, 'total', money(state.liters * state.stationFuel.price));

    setField(
        screen,
        'review-note',
        state.pending?.priceChanged
            ? 'Цена изменилась. Проверьте новую стоимость перед подтверждением.'
            : 'После подтверждения сумма будет временно заблокирована на лимите.'
    );
}

function renderFueling() {
    const screen = show('fueling-screen');
    const f = state.fueling;

    const statuses = {
        accepted: 'Заказ принят',
        waiting_nozzle: 'Ожидание установки пистолета',
        fueling: 'Идёт заправка'
    };

    setField(screen, 'status', statuses[f.status] || f.status);
    setField(screen, 'station', f.stationName);
    setField(screen, 'fuel', f.fuelName);
    setField(screen, 'pump', pumpName(f.pump));
    setField(screen, 'liters', `${f.liters} л`);
    setField(screen, 'current', `${f.currentLiters || 0} л`);
    setField(screen, 'price', `${money(f.price)}/л`);
    setField(screen, 'amount', money(f.amountHeld));

    const percent = Math.min(100, (f.currentLiters || 0) / f.liters * 100);
    screen.querySelector('[data-field="progress"]').style.width = `${percent}%`;

    const notes = {
        accepted: 'АЗС приняла заказ. Ожидаем начала заправки.',
        waiting_nozzle: 'Установите пистолет на выбранной колонке.',
        fueling: 'Заправка выполняется. Статус обновляется автоматически.'
    };

    setField(screen, 'note', state.pollError || notes[f.status] || '');
    screen.querySelector('[data-action="cancel"]').hidden =
        !['accepted', 'waiting_nozzle'].includes(f.status);
}

function renderResult() {
    const screen = show('result-screen');
    const f = state.fueling;
    const completed = f.status === 'completed';

    const reasons = {
        DRIVER_CANCELLED: 'Вы отменили заказ.',
        PUMP_TIMEOUT: 'Не удалось установить пистолет вовремя.',
        STATION_NO_RESPONSE: 'АЗС не ответила на запрос.'
    };

    setField(
        screen,
        'title',
        completed ? 'Заправка завершена' : 'Заправка отменена'
    );

    setField(
        screen,
        'message',
        completed
            ? 'Топливо заправлено, средства списаны по фактическому объёму.'
            : reasons[f.reason] || 'Заправка не была выполнена.'
    );

    setField(screen, 'liters', completed ? `${f.factLiters} л` : '0 л');
    setField(screen, 'amount', completed ? money(f.factAmount) : money(0));
    setField(screen, 'price', `${money(f.price)}/л`);
    setField(screen, 'limit', money(state.trip.limitLeft));
}

function render() {
    if (state.loading || state.error) {
        const screen = show('message-screen');

        const titles = {
            home: 'Заправка в рейсе',
            fuels: 'Выбор топлива',
            stations: 'Выбор АЗС',
            pumps: 'Выбор колонки',
            liters: 'Объём заправки',
            review: 'Проверка выбора',
            sending: 'Отправка заказа',
            fueling: 'Заправка'
        };

        setField(screen, 'title', titles[state.page]);
        setField(
            screen,
            'message',
            state.loading ? 'Загрузка данных...' : state.error
        );
    } else {
        if (state.page === 'home') renderHome();
        if (state.page === 'fuels') renderFuels();
        if (state.page === 'stations') renderStations();
        if (state.page === 'pumps') renderPumps();
        if (state.page === 'liters') renderLiters();
        if (state.page === 'review') renderReview();
        if (state.page === 'fueling') renderFueling();
        if (state.page === 'result') renderResult();
    }

    const buttons = {
        fuels: ['back', 'На главную'],
        stations: ['back', 'К выбору топлива'],
        pumps: ['back', 'К списку АЗС']
    };

    if (state.loading || state.error) {
        bottomButton.dataset.action = 'retry';
        bottomButton.textContent = state.loading ? 'Загрузка...' : 'Повторить';
    } else if (state.page === 'home') {
        bottomButton.dataset.action = 'stations';
        bottomButton.textContent = 'Заправиться';
    } else if (state.page === 'liters') {
        bottomButton.dataset.action = 'review';
        bottomButton.textContent = 'Проверить выбор';
    } else if (state.page === 'review') {
        bottomButton.dataset.action = 'confirm';
        bottomButton.textContent = state.pending?.priceChanged
            ? 'Подтвердить новую цену'
            : 'Подтвердить заправку';
    } else if (state.page === 'fueling') {
        bottomButton.dataset.action = 'refresh';
        bottomButton.textContent = 'Обновить статус';
    } else if (state.page === 'result') {
        bottomButton.dataset.action = 'new-fueling';
        bottomButton.textContent = 'Новая заправка';
    } else {
        [bottomButton.dataset.action, bottomButton.textContent] = buttons[state.page];
    }

    bottomButton.disabled = state.loading ||
        (state.page === 'liters' && !!litersError());
}

async function load(page, request, save, message, after) {
    state.page = page;
    state.loading = true;
    state.error = '';
    state.retry = () => load(page, request, save, message, after);

    render();

    try {
        save(await request());
    } catch (e) {
        state.error = message;
    }

    state.loading = false;
    render();

    if (!state.error && after) await after();
}

function loadFuelOptions() {
    return load(
        'fuels',
        () => Promise.all([
            FakeApi.getDriverLocation(),
            FakeApi.getStations()
        ]),
        ([location, stations]) => {
            state.location = location;
            state.stations = stations;
        },
        'Не удалось загрузить данные. Проверьте соединение.'
    );
}

function loadStation(id) {
    return load(
        'pumps',
        () => FakeApi.getStation(id),
        station => {
            state.station = station;
            state.stationFuel = station.fuels.find(f => f.code === state.fuel.code);
        },
        'Не удалось загрузить информацию об АЗС.'
    );
}

function createPending() {
    const request = {
        stationId: state.station.id,
        pump: state.pump.number,
        fuel: state.fuel.code,
        liters: state.liters,
        price: state.stationFuel.price,
        clientRequestId: `fuel_${Date.now()}_${Math.random().toString(36).slice(2)}`
    };

    state.pending = {
        request,
        fuelingId: null,
        priceChanged: false,
        selection: {
            station: state.station,
            fuel: state.fuel,
            stationFuel: state.stationFuel,
            pump: state.pump,
            liters: state.liters
        }
    };

    savePending();
}

function isFinished() {
    return ['completed', 'cancelled'].includes(state.fueling?.status);
}

async function finishFueling() {
    clearTimeout(pollTimer);

    try {
        state.trip = await FakeApi.getTrip();
    } catch {}

    state.page = 'result';
    render();
}

function schedulePolling() {
    clearTimeout(pollTimer);

    if (state.page === 'fueling' && !isFinished()) {
        pollTimer = setTimeout(refreshFueling, 2000);
    }
}

async function refreshFueling() {
    if (polling || !state.fueling?.id) return;

    clearTimeout(pollTimer);
    polling = true;

    try {
        state.fueling = await FakeApi.getFueling(state.fueling.id);
        state.pollError = '';
    } catch {
        state.pollError = 'Не удалось обновить статус. Повторим запрос автоматически.';
    }

    polling = false;

    if (isFinished()) {
        await finishFueling();
    } else {
        render();
        schedulePolling();
    }
}

async function submitFueling() {
    if (!state.pending || state.loading) return;

    state.page = 'sending';
    state.loading = true;
    state.error = '';
    state.retry = submitFueling;
    render();

    try {
        state.fueling = await FakeApi.startFueling(state.pending.request);

        state.pending.fuelingId = state.fueling.id;
        state.pending.priceChanged = false;
        savePending();

        state.loading = false;
        state.page = 'fueling';
        render();

        if (isFinished()) {
            await finishFueling();
        } else {
            schedulePolling();
        }
    } catch (e) {
        state.loading = false;

        if (e.code === 'NETWORK_ERROR') {
            state.page = 'sending';
            state.error = 'Не удалось получить ответ. Повторите запрос — повторное списание не произойдёт.';
        } else if (e.code === 'PRICE_CHANGED') {
            const price = Number(e.details?.newPrice);

            state.pending.request.price = price;
            state.pending.priceChanged = true;
            state.pending.selection.stationFuel.price = price;
            state.stationFuel.price = price;
            savePending();

            state.page = 'review';
        } else if (e.code === 'PUMP_BUSY') {
            const pump = state.station.pumps.find(
                p => p.number === state.pending.request.pump
            );

            if (pump) pump.status = 'busy';

            clearPending();
            state.pump = null;
            state.notice = 'Колонка стала недоступна. Выберите другую.';
            state.page = 'pumps';
        } else if (e.code === 'LIMIT_EXCEEDED') {
            if (Number.isFinite(e.details?.available)) {
                state.trip.limitLeft = e.details.available;
            }

            clearPending();
            state.notice = e.message;
            state.page = 'liters';
        } else {
            state.page = 'sending';
            state.error = e.message || 'Не удалось отправить заказ.';
        }

        render();
    }
}

async function cancelFueling() {
    if (state.loading || polling) return;

    state.loading = true;
    state.page = 'fueling';
    state.retry = cancelFueling;
    render();

    try {
        state.fueling = await FakeApi.cancelFueling(state.fueling.id);
        state.loading = false;
        await finishFueling();
    } catch (e) {
        state.loading = false;

        if (e.code === 'CANNOT_CANCEL') {
            state.pollError = 'Заправка уже началась. Отмена недоступна.';
        } else {
            state.pollError = 'Не удалось отменить заказ. Проверьте статус.';
        }

        render();
        schedulePolling();
    }
}

async function restoreOrder() {
    if (state.pending) {
        restorePending();

        if (state.pending.priceChanged) {
            state.page = 'review';
            render();
            return;
        }

        if (state.pending.fuelingId) {
            try {
                state.fueling = await FakeApi.getFueling(state.pending.fuelingId);
            } catch {
                state.page = 'sending';
                state.error = 'Не удалось восстановить заказ. Повторите запрос.';
                state.retry = restoreOrder;
                render();
                return;
            }
        } else {
            await submitFueling();
            return;
        }
    } else {
        try {
            state.fueling = await FakeApi.getActiveFueling();
        } catch {
            return;
        }

        if (!state.fueling) return;

        state.pending = { fuelingId: state.fueling.id };
        savePending();
    }

    if (isFinished()) {
        await finishFueling();
    } else {
        state.page = 'fueling';
        render();
        schedulePolling();
    }
}

content.addEventListener('input', e => {
    if (!e.target.matches('[data-field="liters"]')) return;

    state.liters = e.target.value === '' ? null : Number(e.target.value);
    state.notice = '';

    setField(
        content,
        'total',
        Number.isFinite(state.liters)
            ? money(state.liters * state.stationFuel.price)
            : '—'
    );

    const warning = litersError();
    setField(content, 'warning', warning);
    content.querySelector('[data-field="warning"]').hidden = !warning;

    bottomButton.disabled = !!warning;
});

app.addEventListener('click', e => {
    const button = e.target.closest('[data-action]');
    if (!button || button.disabled || state.loading) return;

    const { action, id } = button.dataset;

    if (action === 'stations') loadFuelOptions();
    if (action === 'station') loadStation(id);
    if (action === 'retry') state.retry?.();
    if (action === 'refresh') refreshFueling();
    if (action === 'cancel') cancelFueling();

    if (action === 'fuel') {
        state.fuel = { code: id, name: fuelNames[id] };
        state.station = null;
        state.stationFuel = null;
        state.pump = null;
        state.liters = null;
        state.notice = '';
        state.page = 'stations';
        render();
    }

    if (action === 'pump') {
        state.pump = state.station.pumps.find(p => p.number === Number(id));
        state.liters = state.station.litersMin;
        state.notice = '';
        state.page = 'liters';
        render();
    }

    if (action === 'review' && !litersError()) {
        state.page = 'review';
        render();
    }

    if (action === 'confirm') {
        if (litersError()) {
            state.page = 'liters';
            render();
            return;
        }

        if (!state.pending) createPending();
        submitFueling();
    }

    if (action === 'edit-station') {
        clearPending();
        state.station = null;
        state.stationFuel = null;
        state.pump = null;
        state.liters = null;
        state.page = 'stations';
        render();
    }

    if (action === 'edit-fuel') {
        clearPending();
        state.fuel = null;
        state.station = null;
        state.stationFuel = null;
        state.pump = null;
        state.liters = null;
        state.page = 'fuels';
        render();
    }

    if (action === 'edit-pump') {
        clearPending();
        state.pump = null;
        state.page = 'pumps';
        render();
    }

    if (action === 'edit-liters') {
        clearPending();
        state.page = 'liters';
        render();
    }

    if (action === 'new-fueling') {
        clearTimeout(pollTimer);
        clearPending();

        state.fueling = null;
        state.fuel = null;
        state.station = null;
        state.stationFuel = null;
        state.pump = null;
        state.liters = null;
        state.notice = '';
        state.pollError = '';
        state.page = 'home';
        render();
    }

    if (action === 'back') {
        const pages = {
            fuels: 'home',
            stations: 'fuels',
            pumps: 'stations'
        };

        state.page = pages[state.page];
        render();
    }
});

load(
    'home',
    () => FakeApi.getTrip(),
    trip => state.trip = trip,
    'Не удалось загрузить данные рейса. Проверьте соединение.',
    restoreOrder
);