// Spots officiels (orientation « face » = direction vers laquelle la plage fait face, en degrés),
// webcams et direction de houle idéale. Utilisé par l'appli et pour générer une page par spot.

export const SPOTS = [
  {id:"barre",       town:"Anglet",            name:"La Barre",          lat:43.527, lon:-1.524, face:290},
  {id:"cavaliers",   town:"Anglet",            name:"Les Cavaliers",     lat:43.516, lon:-1.530, face:290},
  {id:"sablesdor",   town:"Anglet",            name:"Sables d'Or",       lat:43.498, lon:-1.545, face:295},
  {id:"grandeplage", town:"Biarritz",          name:"Grande Plage",      lat:43.484, lon:-1.559, face:315},
  {id:"cotebasques", town:"Biarritz",          name:"Côte des Basques",  lat:43.477, lon:-1.568, face:280},
  {id:"ilbarritz",   town:"Bidart",            name:"Ilbarritz",         lat:43.455, lon:-1.578, face:300},
  {id:"pavillon",    town:"Bidart",            name:"Pavillon Royal",    lat:43.451, lon:-1.581, face:300},
  {id:"erretegia",   town:"Bidart",            name:"Erretegia",         lat:43.445, lon:-1.588, face:305},
  {id:"centmarches", town:"Bidart",            name:"100 Marches",       lat:43.440, lon:-1.594, face:305},
  {id:"bidartcentre",town:"Bidart",            name:"Centre",            lat:43.4376, lon:-1.5961, face:305},
  {id:"uhabia",      town:"Bidart",            name:"Uhabia",            lat:43.4311, lon:-1.5987, face:310},
  {id:"parlementia", town:"Guéthary",          name:"Parlementia",       lat:43.428, lon:-1.611, face:310, reef:true},
  {id:"avalanche",   town:"Guéthary",          name:"Avalanche",         lat:43.430, lon:-1.622, face:310, big:true},
  {id:"cenitz",      town:"Guéthary",          name:"Cenitz",            lat:43.423, lon:-1.619, face:320},
  {id:"mayarco",     town:"Saint-Jean-de-Luz", name:"Mayarco",           lat:43.418, lon:-1.626, face:320},
  {id:"lafitenia",   town:"Saint-Jean-de-Luz", name:"Lafitenia",         lat:43.415, lon:-1.627, face:320},
  {id:"gauchelafit", town:"Saint-Jean-de-Luz", name:"Gauche de Lafit",   lat:43.414, lon:-1.630, face:325, reef:true},
  {id:"erromardie",  town:"Saint-Jean-de-Luz", name:"Erromardie",        lat:43.403, lon:-1.643, face:330},
  {id:"saintebarbe", town:"Saint-Jean-de-Luz", name:"Sainte-Barbe",      lat:43.393, lon:-1.658, face:325, reef:true},
  {id:"bougie",      town:"Ciboure",           name:"La Bougie (Socoa)", lat:43.394, lon:-1.684, face:20,  reef:true},
  {id:"belharra",    town:"Urrugne",           name:"Belharra",          lat:43.405, lon:-1.665, face:315, big:true},
  {id:"deuxjumeaux", town:"Hendaye",           name:"Les Deux Jumeaux",  lat:43.380, lon:-1.763, face:340, reef:true},
  {id:"hendaye",     town:"Hendaye",           name:"Grande Plage",      lat:43.375, lon:-1.772, face:345},
  // Landes (côte rectiligne face à l'ouest ; marée de Socoa, à quelques minutes près)
  {id:"labenne",     town:"Labenne",           name:"Labenne Océan",     lat:43.5955, lon:-1.4605, face:280, region:"Landes"},
  {id:"graviere",    town:"Hossegor",          name:"La Gravière",       lat:43.6705, lon:-1.4440, face:280, region:"Landes"},
  {id:"penon",       town:"Seignosse",         name:"Le Penon",          lat:43.7080, lon:-1.4370, face:280, region:"Landes"},
  {id:"messanges",   town:"Messanges",         name:"Messanges",         lat:43.8135, lon:-1.4040, face:280, region:"Landes"},
  {id:"biscarrosse", town:"Biscarrosse",       name:"Biscarrosse Plage", lat:44.4470, lon:-1.2560, face:280, region:"Landes"},
];

export const QS = "https://www.quiksilver.fr/surf-webcams/";
export const CAMS = {
  cotebasques: {url: QS+"biarritz-cote-des-basques.html", label:"Côte des Basques"},
  grandeplage: {url: QS+"biarritz-la-grande-plage.html", label:"Grande Plage de Biarritz"},
  sablesdor:   {url: QS+"anglet.html", label:"Anglet, Le Club et Sables d'Or"},
  parlementia: {url: QS+"guethary.html", label:"Parlementia, Bidart Centre et Guéthary"},
  bidartcentre:{url: QS+"guethary.html", label:"Parlementia, Bidart Centre et Guéthary"},
  saintebarbe: {url: QS+"saint-jean-de-luz.html", label:"Saint-Jean-de-Luz, Sainte-Barbe"},
  hendaye:     {url: QS+"hendaye.html", label:"Hendaye Plage et Deux Jumeaux"},
  deuxjumeaux: {url: QS+"hendaye.html", label:"Hendaye Plage et Deux Jumeaux"},
};

export const SWELL = {
  barre:[295], cavaliers:[295], sablesdor:[295], grandeplage:[300], cotebasques:[290],
  ilbarritz:[300], pavillon:[300], erretegia:[300], centmarches:[300], bidartcentre:[300], uhabia:[300],
  parlementia:[300], avalanche:[300], cenitz:[300],
  mayarco:[300], lafitenia:[305], gauchelafit:[300], erromardie:[315],
  saintebarbe:[320,[15,35]], bougie:[315,[15,35]], belharra:[305],
  deuxjumeaux:[320,[15,35]], hendaye:[320,[15,35]],
  labenne:[285,[25]], graviere:[285,[25]], penon:[285,[25]], messanges:[285,[25]], biscarrosse:[285,[25]],
};
