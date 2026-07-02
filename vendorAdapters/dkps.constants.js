const categories = {
    'MOCHILAS Y MORRALES': '', //
    'BOLSAS ECOLÓGICAS': 'ecologicos,bolsas ecologicas,textil,bolsas y morrales',
    'CAMISAS': 'textil,playeras y camisas',
    'GORRAS': 'textil,gorras y cangureras',
    'GORRAS PREMIUM': 'textil,gorras y cangureras',
    'PLAYERAS': 'textil,playeras y camisas',
    'SUDADERAS': 'textil,chamarras y chalecos',
    'TERMOS': 'bebidas,termos',
    'CILINDROS': 'bebidas,cilindros de plastico',
    'INTERNO': 'hogar,accesorios del hogar',
}

const printingTechniques = {
    'MOCHILAS Y MORRALES': [
        'Recorte de Vinil',
        'DTF',
        'Sublibordado',
        'Vinil Impreso',
        'Bordado',
        'Sublimación (solo color blanco)', // 100
    ],
    'BOLSAS ECOLÓGICAS': [
        'Recorte de Vinil',
        'DTF',
        'Sublibordado',
        'Vinil Impreso',
        'Bordado',
        'Sublimación',
        'Serigrafía'
    ],
    'CAMISAS': [
        'Recorte de Vinil',
        'DTF',
        'Sublibordado',
        'Vinil Impreso',
        'Bordado',
        'Sublimación',
        'Serigrafía'
    ],
    'GORRAS': [
        'Recorte de Vinil',
        'DTF',
        'Sublibordado',
        'Vinil Impreso',
        'Bordado',
        'Sublimación', // 710, 701, 601, 600, 405, 400, 130, 125
    ],
    'GORRAS PREMIUM': [
        'Recorte de Vinil',
        'DTF',
        'Sublibordado',
        'Vinil Impreso',
        'Bordado',
    ],
    'PLAYERAS': [
        'Recorte de Vinil',
        'DTF',
        'Sublibordado',
        'Vinil Impreso',
        'Bordado',
        'Sublimación',
        'Serigrafía'
    ],
    'SUDADERAS': [
        'Recorte de Vinil',
        'DTF',
        'Sublibordado',
        'Vinil Impreso',
        'Bordado',
        'Sublimación',
        'Serigrafía'
    ],
    'TERMOS': [
        'Recorte de Vinil',
        'Impresión UV 360',
        'Grabado Láser', // En Acero inoxidable / plástico
        // 'DTF UV', // Solo en Acero inoxidable / plástico
        'Sublimación (solo color blanco)', // No en 160, 170
    ],
    'CILINDROS': ['Serigrafía'],
    'INTERNO': ['Sublibordado'],
};

const surfaces = [
    '100% poliéster', // Mochilas, gorras, gorras premium, sudaderas
    '100% non woven', // Solo bolsas
    '50% Algodón 50% Poliéster', // Solo bolsas
    'Non woven', // Solo bolsas
    '100% poliester', // Solo mochilas
    '88% Nylon 12% Spandex', // Camisas, playeras
    '100% Algodón', // Solo gorras
    '65% Algodón 35 % Poliester', // Solo gorras
    '65% Algondon 35% Poliester', // Solo gorras
    '65% Algodón 35% Poliester', // Solo gorras
    '98% Poliester 2% Spandex', // Solo gorras
    '98% Poliester 2% Algodón', // Solo gorras
    '100% acrílico', // Solo gorras
    '50% Algodón 50% Poliester', // Solo gorras
    '50% Algodon 50% Poliester', // Solo gorras
    'null',
    '87% Nylon 13% Spandex', // Solo gorras premium
    '80% Algodón 20% Poliéster', // Solo gorras premium
    '60% Poliester 32% Nylon 8% Spandex', // Solo gorras premium
    '60% Poliéster 32% Nylon 8% Spandex', // Solo gorras premium
    '65% Poliester 33% Nylon 2% Spandex', // Solo gorras premium
    '65% Poliéster 33% Nylon 2% Spandex', // Solo gorras premium
    '97% Algodón 3% Spandex', // Solo gorras premium
    '90% Poliéster 10% Algodón', // Solo gorras premium
    '85% Poliéster 10% Algodón 5% Spandex', // Solo gorras premium
    '35 % Algodón 65% Poliéster', // Solo playeras
    'Acero inoxidable', // Solo termos
    '100 % Pet', // Solo cilindros
    'Acero inoxidable / plástico', // Solo termos
];

const normalizedSurfaces = {
    '100% poliéster': 'TEXTIL',
    '100% non woven': 'TEXTIL',
    '50% Algodón 50% Poliéster': 'TEXTIL',
    'Non woven': 'TEXTIL',
    '100% poliester': 'TEXTIL',
    '88% Nylon 12% Spandex': 'TEXTIL',
    '100% Algodón': 'TEXTIL',
    '65% Algodón 35 % Poliester': 'TEXTIL',
    '65% Algondon 35% Poliester': 'TEXTIL',
    '65% Algodón 35% Poliester': 'TEXTIL',
    '98% Poliester 2% Spandex': 'TEXTIL',
    '98% Poliester 2% Algodón': 'TEXTIL',
    '100% acrílico': 'TEXTIL',
    '50% Algodón 50% Poliester': 'TEXTIL',
    '50% Algodon 50% Poliester': 'TEXTIL',
    'null': '',
    '87% Nylon 13% Spandex': 'TEXTIL',
    '80% Algodón 20% Poliéster': 'TEXTIL',
    '60% Poliester 32% Nylon 8% Spandex': 'TEXTIL',
    '60% Poliéster 32% Nylon 8% Spandex': 'TEXTIL',
    '65% Poliester 33% Nylon 2% Spandex': 'TEXTIL',
    '65% Poliéster 33% Nylon 2% Spandex': 'TEXTIL',
    '97% Algodón 3% Spandex': 'TEXTIL',
    '90% Poliéster 10% Algodón': 'TEXTIL',
    '85% Poliéster 10% Algodón 5% Spandex': 'TEXTIL',
    '35 % Algodón 65% Poliéster': 'TEXTIL',
    'Acero inoxidable': 'METAL',
    '100 % Pet': 'PLÁSTICO',
    'Acero inoxidable / plástico': 'METAL',
};

const normalizedPrintingTechniques = {
    'Recorte de Vinil': 'FULL COLOR',
    'DTF': 'FULL COLOR',
    'DTF UV': 'FULL COLOR',
    'Sublibordado': 'SUBLIMACION',
    'Vinil Impreso': 'FULL COLOR',
    'Bordado': 'BORDADO',
    'Sublimación (solo color blanco)': 'SUBLIMACION',
    'Sublimación': 'SUBLIMACION',
    'Serigrafía': 'SERIGRAFÍA',
    'Impresión UV 360': 'FULL COLOR',
    'Grabado Láser': 'GRABADO LÁSER',
};

const warehouses = [
    'ALMACEN GENERAL MÉXICO',
    'MATRIZ',
    'ALGARÍN 1',
    'ALGARÍN 2',
    'ALGARIN 3',
    'CORREO MAYOR',
];

module.exports = { categories, printingTechniques, normalizedSurfaces, normalizedPrintingTechniques, warehouses };
