const surfaces = {
    'POLIESTER FINO': 'TEXTIL', 'NYLON LIGHT': 'TEXTIL', 'MICROFIBRA PARIS': 'TEXTIL',
    'NEOPRENO': 'TEXTIL', 'ALGODON PIQUE': 'TEXTIL', 'ALGODON': 'TEXTIL',
    'MICROFIBRA SUPER': 'TEXTIL', 'DOUBLE TECH': 'TEXTIL',
};

const categoryMap = {
    'CHAMARRA': 'textil,chamarras y chalecos',
    'CHALECO': 'textil,chamarras y chalecos',
    'POLO BASICA': 'textil,playeras',
    'CAMISA': 'textil,playeras',
};

const colorMap = {
    'MAR': 'MARINO', 'NEG': 'NEGRO', 'GRO': 'GRIS', 'VIN': 'VINO', 'AZA': 'AZUL ACERO',
    'ROJ': 'ROJO', 'OLI': 'OLIVO', 'ARE': 'ARENA', 'CHO': 'CHOCOLATE', 'TOP': 'TOPO',
    'BLA': 'BLANCO', 'CIE': 'AZUL CIELO', 'OXJ': 'OXFORD', 'AZU': 'AZUL CIAN', 'ROS': 'ROSA',
    'LAD': 'LADRILLO',
};

const printingTechniques = [
    'Recorte de Vinil',
    'DTF',
    'Sublibordado',
    'Vinil Impreso',
    'Bordado',
    'Sublimación',
    'Serigrafía',
];

const normalizedPrintingTechniques = {
    'Recorte de Vinil': 'FULL COLOR',
    'DTF': 'FULL COLOR',
    'Sublibordado': 'SUBLIMACION',
    'Vinil Impreso': 'FULL COLOR',
    'Bordado': 'BORDADO',
    'Sublimación': 'SUBLIMACION',
    'Serigrafía': 'SERIGRAFÍA',
};

const SIZE_GUIDE_URL = 'https://www.preslow.com/_next/image?url=%2Fimages%2FGuiaTallas.jpg&w=1200&q=75';

module.exports = {
    surfaces,
    categoryMap,
    colorMap,
    printingTechniques,
    normalizedPrintingTechniques,
    SIZE_GUIDE_URL,
};
