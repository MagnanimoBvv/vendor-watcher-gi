
const skipAdventages = [
    'Capacidad',
    'N/A',
    'Peso',
    'Térmico',
];

const ecoAdventages = [
    'Eco-friendly',
    'Biodegradable',
    'Eco-responsable',
];

const categories = {
    'bolígrafos de plástico': 'oficina,boligrafos de plastico',
    'bebidas y alimentos': '',
    'bolígrafos de metal': 'oficina,boligrafos de metal',
    'oficina': 'oficina',
    'mochilas y viajes': '',
    'libretas': 'oficina,libretas y carpetas',
    'electrónicos': 'tecnologia',
    'llaveros y herramientas': 'tiempo libre',
};

const extraCategories = {
    'Botella Acero inoxidable': 'bebidas,termos',
    'Ánfora Acero inoxidable': 'bebidas,cilindros de metal y vidrio',
    'Textura Acero inoxidable': 'bebidas,termos',
    'Termo Acero inoxidable': 'bebidas,termos',
    'Para Acero inoxidable': 'bebidas,termos',
    'Cilindro Aluminio': 'bebidas,cilindros de metal y vidrio',
    'Anfora Acero inoxidable': 'bebidas,cilindros de metal y vidrio',
    'Botella Policarbonato': 'bebidas,cilindros de plastico',
    'Cilindro Policarbonato': 'bebidas,cilindros de plastico',
    'Cilindro Plástico': 'bebidas,cilindros de plastico',
    'Este Aluminio': 'hogar,cocina',
    'Contenedor Plástico grado alimenticio': 'hogar,cocina',
    'Lonchera Tela repelente': 'textil,hieleras y loncheras',
    'Lonchera Membrana Dermalis': 'textil,hieleras y loncheras',
    'Taza Vidrio borosilicato': 'bebidas,tazas',
    'Taza Acero inoxidable': 'bebidas,tazas',
    'undefined ACERO INOXIDABLE': 'bebidas,termos',
    'Disfruta Acero inoxidable': 'bebidas,termos',
    'Un Acero inoxidable': 'bebidas,termos',
    'Con Acero inoxidable': 'bebidas,termos',
    'Vaso Acero inoxidable': 'bebidas,termos',
    'Vaso Acero Inoxidable': 'bebidas,termos',
    'Funcionalidad Vidrio de borosilicato': 'bebidas,vasos',
    'Además Acero inoxidable': 'bebidas,termos',
    'Vaso Acrílico': 'bebidas,vasos',
};

const normalizedSurfaces = {
    'Plástico': 'PLÁSTICO',
    'Acero inoxidable': 'METAL',
    'Aluminio': 'METAL',
    'Latón': 'METAL',
    'Tela satinada': 'TEXTIL',
    'Poliéster/nylon': 'TEXTIL',
    'Nylon Balístico': 'TEXTIL',
    'Policarbonato': 'PLÁSTICO',
    'Piel vegana': 'TEXTIL',
    'Nylon': 'TEXTIL',
    'EVA/Chapa de madera': 'MADERA',
    'Samac': 'METAL',
    'Acero inoxidable/Aluminio': 'METAL',
    'Lemongrass (hierba de limón': 'MADERA',
    'Estiércol de elefante': 'PLÁSTICO',
    'Trapos de algodón reciclados': 'TEXTIL',
    'Poliuretano': 'PLÁSTICO',
    'Piel reciclada': 'TEXTIL',
    'Thermo PU': 'PLÁSTICO',
    'Papel Texturizado': 'MADERA',
    'Piel vegana terciopelo': 'TEXTIL',
    'Metal': 'METAL',
    'Zamac': 'METAL',
    'Plástico grado alimenticio': 'PLÁSTICO',
    'Tela repelente': 'TEXTIL',
    'Membrana Dermalis': 'TEXTIL',
    'Poliéster': 'TEXTIL',
    'Papel entintado': 'MADERA',
    'Acrílico': 'PLÁSTICO',
    'Silicón': 'PLÁSTICO',
    'Papel reciclado': 'MADERA',
    'PLASTICO': 'PLÁSTICO',
    'EVA/piel vegana': 'TEXTIL',
    'Vidrio borosilicato': 'VIDRIO',
    'ACERO INOXIDABLE': 'METAL',
    'Acero Inoxidable': 'METAL',
    'Vidrio de borosilicato': 'VIDRIO',
};

const normalizedPrintingTechniques = {
    'TAMPOGRAFIA': 'SERIGRAFÍA',
    'LASER': 'GRABADO LÁSER',
    'SERIGRAFIA': 'SERIGRAFÍA',
    'HOT STAMPING': 'FULL COLOR',
    'Bajo Relieve': 'GRABADO LÁSER',
    'Bordado (No incluido)': 'BORDADO',
    'BAJO RELIEVE': 'GRABADO LÁSER',
    'Oxidación Sónica': 'GRABADO LÁSER',
    'Barniz': 'SERIGRAFÍA',
    'Alto Relieve': 'GRABADO LÁSER',
    '3D': 'GRABADO LÁSER',
};

const quantitys = [
    100,
    500,
    1000,
];

module.exports = { skipAdventages, ecoAdventages, categories, extraCategories, normalizedSurfaces, normalizedPrintingTechniques, quantitys };