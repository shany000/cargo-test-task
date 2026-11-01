'use strict';

const app = document.getElementById('app');
const content = document.getElementById('content');
const bottomButton = document.getElementById('bottom-button');

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
            price: Math.min(...available.map(s => s.prices[code]))
        };
    }).filter(f => f.count > 0);

    options.forEach(f => {
        const option = clone('fuel-option');

        setField(option, 'name', f.name);
        setField(option, 'details', `${f.count} АЗС в радиусе 30 км`);
        setField(option, 'price', `от ${money(f.price)}/л`);

        option.querySelector('[data-action="fuel"]').dataset.id = f.code;
        container.append(option);
    });

    if (!options.length) {
        setField(screen, 'empty', 'В радиусе 30 км нет доступного топлива.');
    }
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
        (result, s) => !result || s.prices[state.fuel.code] < result.prices[state.fuel.code]
            ? s
            : result,
        null
    );

    if (best) {
        container.append(renderStationCard(best, true));
    }

    const groups = [
        { title: 'До 10 км', min: 0, max: 10 },
        { title: '10–20 км', min: 10, max: 20 },
        { title: '20–30 км', min: 20, max: 30 }
    ];

    groups.forEach(group => {
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

    if (!stations.length) {
        setField(screen, 'empty', 'Нет АЗС с выбранным топливом в радиусе 30 км.');
    }
}

function pumpName(pump) {
    const letters = ['А', 'Б', 'В', 'Г'];

    if (state.station.brand === 'Колесо' && letters[pump.number - 1]) {
        return `Колонка ${letters[pump.number - 1]} · № ${pump.number}`;
    }

    return `Колонка № ${pump.number}`;
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

        setField(option, 'name', pumpName(p));
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

    if (!available) {
        setField(screen, 'note', 'Нет свободных колонок с выбранным топливом.');
    } else {
        screen.querySelector('[data-field="note"]').hidden = true;
    }
}

function litersError() {
    if (!Number.isFinite(state.liters)) {
        return 'Укажите количество литров.';
    }

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
    setField(screen, 'pump', pumpName(state.pump));
    setField(screen, 'price', money(state.stationFuel.price));
    setField(screen, 'limits', `${state.station.litersMin}–${state.station.litersMax} л`);

    const input = screen.querySelector('[data-field="liters"]');
    input.min = state.station.litersMin;
    input.max = state.station.litersMax;
    input.value = state.liters;

    setField(screen, 'total', money(state.liters * state.stationFuel.price));

    const error = litersError();
    setField(screen, 'warning', error);
    screen.querySelector('[data-field="warning"]').hidden = !error;
}

function renderReview() {
    const screen = show('review-screen');

    setField(screen, 'station', state.station.name);
    setField(screen, 'fuel', state.stationFuel.name);
    setField(screen, 'pump', pumpName(state.pump));
    setField(screen, 'liters', `${state.liters} л`);
    setField(screen, 'price', `${money(state.stationFuel.price)}/л`);
    setField(screen, 'total', money(state.liters * state.stationFuel.price));
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
            review: 'Проверка выбора'
        };

        setField(screen, 'title', titles[state.page]);
        setField(screen, 'message', state.loading
            ? 'Загрузка данных...'
            : state.error
        );
    } else {
        if (state.page === 'home') renderHome();
        if (state.page === 'fuels') renderFuels();
        if (state.page === 'stations') renderStations();
        if (state.page === 'pumps') renderPumps();
        if (state.page === 'liters') renderLiters();
        if (state.page === 'review') renderReview();
    }

    const buttons = {
        fuels: ['back', 'На главную'],
        stations: ['back', 'К выбору топлива'],
        pumps: ['back', 'К списку АЗС'],
        liters: ['back', 'К выбору колонки']
    };

    if (state.loading || state.error) {
        bottomButton.dataset.action = 'retry';
        bottomButton.textContent = state.loading ? 'Загрузка...' : 'Повторить';
    } else if (state.page === 'home') {
        bottomButton.dataset.action = 'stations';
        bottomButton.textContent = 'Заправиться';
    } else if (state.page === 'review') {
        bottomButton.dataset.action = 'edit-fuel';
        bottomButton.textContent = 'Изменить выбор';
    } else if (state.page === 'liters') {
        bottomButton.dataset.action = 'review';
        bottomButton.textContent = 'Проверить выбор';
    } else {
        [bottomButton.dataset.action, bottomButton.textContent] = buttons[state.page];
    }

    bottomButton.disabled = state.loading ||
        (state.page === 'liters' && !!litersError());
}

async function load(page, request, save, message) {
    state.page = page;
    state.loading = true;
    state.error = '';
    state.retry = () => load(page, request, save, message);

    render();

    try {
        save(await request());
    } catch (e) {
        state.error = message;
    }

    state.loading = false;
    render();
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
    state.station = null;
    state.stationFuel = null;
    state.pump = null;
    state.liters = null;

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

content.addEventListener('input', e => {
    if (!e.target.matches('[data-field="liters"]')) return;

    state.liters = e.target.value === '' ? null : Number(e.target.value);

    setField(
        content,
        'total',
        Number.isFinite(state.liters)
            ? money(state.liters * state.stationFuel.price)
            : '—'
    );

    const error = litersError();
    setField(content, 'warning', error);
    content.querySelector('[data-field="warning"]').hidden = !error;

    bottomButton.disabled = !!error;
});

app.addEventListener('click', e => {
    const button = e.target.closest('[data-action]');
    if (!button || button.disabled) return;

    const { action, id } = button.dataset;

    if (action === 'stations') loadFuelOptions();
    if (action === 'station') loadStation(id);
    if (action === 'retry') state.retry?.();

    if (action === 'fuel') {
        state.fuel = { code: id, name: fuelNames[id] };
        state.station = null;
        state.stationFuel = null;
        state.pump = null;
        state.liters = null;
        state.page = 'stations';
        render();
    }

    if (action === 'pump') {
        state.pump = state.station.pumps.find(p => p.number === Number(id));
        state.liters = state.station.litersMin;
        state.page = 'liters';
        render();
    }

    if (action === 'review' && !litersError()) {
        state.page = 'review';
        render();
    }

    if (action === 'edit-station') {
        state.station = null;
        state.stationFuel = null;
        state.pump = null;
        state.liters = null;
        state.page = 'stations';
        render();
    }

    if (action === 'edit-fuel') {
        state.fuel = null;
        state.station = null;
        state.stationFuel = null;
        state.pump = null;
        state.liters = null;
        state.page = 'fuels';
        render();
    }

    if (action === 'edit-pump') {
        state.pump = null;
        state.page = 'pumps';
        render();
    }

    if (action === 'edit-liters') {
        state.page = 'liters';
        render();
    }

    if (action === 'back') {
        const pages = {
            fuels: 'home',
            stations: 'fuels',
            pumps: 'stations',
            liters: 'pumps'
        };

        state.page = pages[state.page];
        render();
    }
});

load(
    'home',
    () => FakeApi.getTrip(),
    trip => state.trip = trip,
    'Не удалось загрузить данные рейса. Проверьте соединение.'
);