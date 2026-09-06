const MOVIES = [
{
  id: "jaws",
  title: "Jaws",
  year: 1975,
  genre: ["Thriller", "Horror"],
  difficulty: 1,
  emojis: ["🌊", "🦈", "🚤", "🩸"],
  explanation: ["The story unfolds around the waters of Amity Island.", "A great white shark terrorizes swimmers.", "Brody, Hooper, and Quint hunt it aboard the Orca.", "The shark's attacks drive the plot's tension."],
  aliases: ["jaws 1975"]
},
{
  id: "star-wars-anh",
  title: "Star Wars",
  year: 1977,
  genre: ["Sci-Fi", "Adventure"],
  difficulty: 1,
  emojis: ["🚀", "⚔️", "👴", "🌌"],
  explanation: ["A rebellion fights across the stars.", "Lightsaber duels define the saga.", "Obi-Wan mentors young Luke.", "The story spans a galaxy far, far away."],
  aliases: ["star wars episode iv", "a new hope"]
},
{
  id: "empire-strikes-back",
  title: "The Empire Strikes Back",
  year: 1980,
  genre: ["Sci-Fi", "Adventure"],
  difficulty: 2,
  emojis: ["🧊", "🤖", "👨‍🦯", "💔"],
  explanation: ["The rebels hide on the ice planet Hoth.", "Bounty hunters and droids pursue the heroes.", "Luke trains with a small green master.", "A shocking father-son reveal breaks hearts."],
  aliases: ["empire strikes back", "star wars episode v"]
},
{
  id: "raiders-lost-ark",
  title: "Raiders of the Lost Ark",
  year: 1981,
  genre: ["Action", "Adventure"],
  difficulty: 2,
  emojis: ["🤠", "🐍", "⛏️", "📦"],
  explanation: ["Indiana Jones is a whip-cracking adventurer.", "He has a famous fear of snakes.", "He races to find ancient artifacts.", "The film centers on the search for the Ark of the Covenant."],
  aliases: ["raiders of the lost ark", "indiana jones raiders"]
},
{
  id: "jurassic-park",
  title: "Jurassic Park",
  year: 1993,
  genre: ["Adventure", "Sci-Fi"],
  difficulty: 1,
  emojis: ["🦖", "🏝️", "🚙", "⚡"],
  explanation: ["Dinosaurs roam the park.", "The park is on a remote island.", "Jeeps tour the enclosures.", "Electric fences try to contain the danger."],
  aliases: ["jurassic park 1993"]
},
{
  id: "et",
  title: "E.T. the Extra-Terrestrial",
  year: 1982,
  genre: ["Family", "Sci-Fi"],
  difficulty: 1,
  emojis: ["👽", "🚲", "🌕", "📞"],
  explanation: ["A stranded alien befriends a boy.", "Their bikes famously fly across the moon.", "The iconic silhouette shows a bike against the full moon.", "E.T. longs to phone home."],
  aliases: ["et", "e.t."]
},
{
  id: "back-to-future",
  title: "Back to the Future",
  year: 1985,
  genre: ["Sci-Fi", "Comedy"],
  difficulty: 1,
  emojis: ["🚗", "⚡", "⏰", "🛹"],
  explanation: ["A modified car is the time machine.", "Lightning powers the flux capacitor.", "Marty travels through time.", "He rides a skateboard through 1955."],
  aliases: ["back to the future"]
},
{
  id: "ghostbusters",
  title: "Ghostbusters",
  year: 1984,
  genre: ["Comedy", "Horror"],
  difficulty: 1,
  emojis: ["👻", "🚫", "🚪", "🏙️"],
  explanation: ["Ghosts haunt the city.", "The team busts and stops them.", "A supernatural portal opens above an apartment building.", "The action takes place in New York City."],
  aliases: []
},
{
  id: "the-matrix",
  title: "The Matrix",
  year: 1999,
  genre: ["Sci-Fi", "Action"],
  difficulty: 1,
  emojis: ["💊", "🔴", "🔵", "🕶️"],
  explanation: ["Neo is offered a choice.", "The red pill reveals the truth.", "The blue pill preserves the illusion.", "Iconic sunglasses define the film's style."],
  aliases: ["matrix"]
},
{
  id: "alien",
  title: "Alien",
  year: 1979,
  genre: ["Sci-Fi", "Horror"],
  difficulty: 2,
  emojis: ["🛸", "👽", "🥚", "🚀"],
  explanation: ["A derelict ship holds a threat.", "A hostile creature stalks the crew.", "The creature hatches from an egg.", "The crew is trapped aboard the Nostromo."],
  aliases: []
},
{
  id: "aliens",
  title: "Aliens",
  year: 1986,
  genre: ["Sci-Fi", "Action"],
  difficulty: 2,
  emojis: ["👽", "🔫", "👩‍🚀", "🐣"],
  explanation: ["The creatures return in greater numbers.", "Marines arrive heavily armed.", "Ripley leads the fight.", "A queen and her eggs are the true threat."],
  aliases: []
},
{
  id: "predator",
  title: "Predator",
  year: 1987,
  genre: ["Sci-Fi", "Action"],
  difficulty: 2,
  emojis: ["🌴", "👽", "🔥", "💪"],
  explanation: ["Commandos are hunted in the jungle.", "An invisible alien stalks them.", "Its heat-vision and thermal camouflage define the threat.", "Muscle-bound soldiers battle for survival."],
  aliases: []
},
{
  id: "terminator-2",
  title: "Terminator 2: Judgment Day",
  year: 1991,
  genre: ["Sci-Fi", "Action"],
  difficulty: 2,
  emojis: ["🤖", "🧒", "🩸", "🕶️"],
  explanation: ["A reprogrammed cyborg is the protagonist.", "He is sent to protect young John Connor.", "A liquid-metal T-1000 can reform after damage.", "Sunglasses and leather define his look."],
  aliases: ["t2", "terminator 2"]
},
{
  id: "blade-runner",
  title: "Blade Runner",
  year: 1982,
  genre: ["Sci-Fi", "Noir"],
  difficulty: 3,
  emojis: ["🌆", "🤖", "☔", "👁️"],
  explanation: ["A neon-lit dystopian city sets the scene.", "Replicants are hunted like machines.", "Constant rain colors the mood.", "Eye imagery recurs throughout the film."],
  aliases: []
},
{
  id: "2001-space-odyssey",
  title: "2001: A Space Odyssey",
  year: 1968,
  genre: ["Sci-Fi"],
  difficulty: 3,
  emojis: ["🦴", "🚀", "🔴", "👶"],
  explanation: ["A thrown bone famously matches-cuts to a spacecraft.", "Humanity's journey to the stars begins.", "HAL's glowing red eye watches the crew.", "The film ends with a mysterious star child."],
  aliases: []
},
{
  id: "the-shining",
  title: "The Shining",
  year: 1980,
  genre: ["Horror"],
  difficulty: 2,
  emojis: ["🏨", "🚪", "🩸", "👯"],
  explanation: ["An isolated hotel traps the family.", "An axe famously breaks through a door.", "Elevators of blood haunt the halls.", "Twin girls appear in a chilling hallway."],
  aliases: []
},
{
  id: "psycho",
  title: "Psycho",
  year: 1960,
  genre: ["Horror", "Thriller"],
  difficulty: 2,
  emojis: ["🚿", "🔪", "🏚️", "👵"],
  explanation: ["A shower scene is the film's most famous moment.", "A knife delivers the shocking attack.", "A gothic motel house looms over the story.", "A mother's presence is more sinister than it seems."],
  aliases: []
},
{
  id: "the-exorcist",
  title: "The Exorcist",
  year: 1973,
  genre: ["Horror"],
  difficulty: 2,
  emojis: ["👧", "😈", "🤢", "✝️"],
  explanation: ["A young girl is possessed.", "A demon has taken hold of her.", "Infamous scenes involve shocking bodily horror.", "Priests attempt a religious exorcism."],
  aliases: []
},
{
  id: "halloween-1978",
  title: "Halloween",
  year: 1978,
  genre: ["Horror"],
  difficulty: 2,
  emojis: ["🔪", "🎃", "😷", "🌙"],
  explanation: ["A masked killer stalks his victims with a knife.", "The story takes place on Halloween night.", "Michael Myers wears a blank white mask.", "Much of the terror unfolds after dark."],
  aliases: []
},
{
  id: "nightmare-elm-street",
  title: "A Nightmare on Elm Street",
  year: 1984,
  genre: ["Horror"],
  difficulty: 2,
  emojis: ["🛏️", "🔪", "🧤", "😴"],
  explanation: ["Victims are attacked in their beds.", "Freddy's weapon is a bladed glove.", "The glove has knives for fingers.", "He can only strike while his victims sleep."],
  aliases: []
},
{
  id: "scream",
  title: "Scream",
  year: 1996,
  genre: ["Horror"],
  difficulty: 2,
  emojis: ["📞", "🔪", "👻", "🎭"],
  explanation: ["A killer calls his victims before attacking.", "He wields a large knife.", "His costume resembles a screaming ghost.", "The film satirizes horror movie tropes with a masked killer."],
  aliases: []
},
{
  id: "silence-of-the-lambs",
  title: "The Silence of the Lambs",
  year: 1991,
  genre: ["Thriller", "Horror"],
  difficulty: 2,
  emojis: ["🦋", "🧠", "🔒", "🐑"],
  explanation: ["Moths recur as a chilling motif.", "A brilliant, cannibalistic mind aids the investigation.", "Hannibal Lecter is kept in a locked cell.", "Clarice hopes to silence the memory of screaming lambs."],
  aliases: []
},
{
  id: "the-godfather",
  title: "The Godfather",
  year: 1972,
  genre: ["Crime", "Drama"],
  difficulty: 1,
  emojis: ["🐴", "🔫", "🍝", "👨‍👦"],
  explanation: ["A severed horse head sends a message.", "The mafia settles disputes with violence.", "Family dinners are central to the culture.", "A father passes power to his son."],
  aliases: []
},
{
  id: "goodfellas",
  title: "Goodfellas",
  year: 1990,
  genre: ["Crime", "Drama"],
  difficulty: 2,
  emojis: ["🕴️", "💵", "🚬", "🔫"],
  explanation: ["Wiseguys live a glamorous criminal life.", "Money flows from illicit schemes.", "Cigarettes and nightclubs define their world.", "Violence is always close at hand."],
  aliases: []
},
{
  id: "scarface",
  title: "Scarface",
  year: 1983,
  genre: ["Crime", "Drama"],
  difficulty: 2,
  emojis: ["❄️", "🔫", "🏝️", "🐘"],
  explanation: ["Cocaine fuels Tony Montana's empire.", "He arms himself heavily as enemies close in.", "The story is set amid Miami's drug trade.", "A famous line invokes 'the world' via a globe statue."],
  aliases: []
},
{
  id: "pulp-fiction",
  title: "Pulp Fiction",
  year: 1994,
  genre: ["Crime"],
  difficulty: 2,
  emojis: ["💼", "💉", "🍔", "🕺"],
  explanation: ["A mysterious glowing briefcase drives the plot.", "An overdose scene is a tense centerpiece.", "Characters discuss burgers at length.", "An iconic dance contest scene stands out."],
  aliases: []
},
{
  id: "reservoir-dogs",
  title: "Reservoir Dogs",
  year: 1992,
  genre: ["Crime"],
  difficulty: 3,
  emojis: ["🕶️", "🤵", "🔫", "🦻"],
  explanation: ["Cool sunglasses and suits define the crew.", "Nameless color-coded criminals plan a heist.", "A robbery goes violently wrong.", "A torture scene involves a severed ear."],
  aliases: []
},
{
  id: "fight-club",
  title: "Fight Club",
  year: 1999,
  genre: ["Drama"],
  difficulty: 2,
  emojis: ["👊", "🧼", "😴", "🤯"],
  explanation: ["Underground brawls give men an outlet.", "Soap-making ties into the plot.", "The narrator suffers from insomnia.", "A twist reveals a shocking identity secret."],
  aliases: []
},
{
  id: "se7en",
  title: "Se7en",
  year: 1995,
  genre: ["Thriller", "Crime"],
  difficulty: 3,
  emojis: ["7️⃣", "📦", "☠️", "🕵️"],
  explanation: ["Seven deadly sins structure the murders.", "A mysterious box appears in the finale.", "A serial killer stages elaborate deaths.", "Two detectives pursue the case."],
  aliases: ["seven"]
},
{
  id: "titanic",
  title: "Titanic",
  year: 1997,
  genre: ["Romance", "Drama"],
  difficulty: 1,
  emojis: ["🚢", "💎", "🧊", "💔"],
  explanation: ["A doomed ocean liner is the setting.", "A priceless necklace, the Heart of the Ocean, matters greatly.", "An iceberg seals the ship's fate.", "Jack and Rose's romance ends in tragedy."],
  aliases: []
},
{
  id: "rocky",
  title: "Rocky",
  year: 1976,
  genre: ["Sports", "Drama"],
  difficulty: 1,
  emojis: ["🥊", "🏃", "🥩", "🏆"],
  explanation: ["A boxer chases his shot at glory.", "Training runs build up his strength.", "He famously punches sides of meat.", "He fights for the championship title."],
  aliases: []
},
{
  id: "raging-bull",
  title: "Raging Bull",
  year: 1980,
  genre: ["Sports", "Drama"],
  difficulty: 3,
  emojis: ["🥊", "⚫", "😡", "📷"],
  explanation: ["A boxer's brutal career is chronicled.", "The film is shot in stark black and white.", "Jealous rage consumes the protagonist.", "Home movie footage punctuates the story."],
  aliases: []
},
{
  id: "karate-kid",
  title: "The Karate Kid",
  year: 1984,
  genre: ["Drama", "Sports"],
  difficulty: 1,
  emojis: ["🥋", "🖌️", "🦩", "👴"],
  explanation: ["A boy learns karate to defend himself.", "Waxing cars secretly teaches technique.", "The famous crane kick wins the tournament.", "An elderly mentor guides his training."],
  aliases: []
},
{
  id: "top-gun",
  title: "Top Gun",
  year: 1986,
  genre: ["Action", "Drama"],
  difficulty: 1,
  emojis: ["✈️", "🕶️", "🏐", "🎖️"],
  explanation: ["Fighter pilots compete for the best of the best.", "Aviators define the swaggering style.", "A famous beach volleyball scene appears.", "Rank and glory drive the pilots' rivalry."],
  aliases: []
},
{
  id: "die-hard",
  title: "Die Hard",
  year: 1988,
  genre: ["Action"],
  difficulty: 1,
  emojis: ["🏢", "🎄", "👮", "🔫"],
  explanation: ["A skyscraper is taken hostage.", "The story takes place on Christmas Eve.", "An off-duty cop becomes the hero.", "He fights terrorists floor by floor."],
  aliases: []
},
{
  id: "speed",
  title: "Speed",
  year: 1994,
  genre: ["Action"],
  difficulty: 2,
  emojis: ["🚌", "💣", "⏱️", "🚓"],
  explanation: ["A city bus is rigged to explode.", "A bomb will detonate if speed drops too low.", "The countdown creates constant tension.", "A cop tries to keep everyone safe."],
  aliases: []
},
{
  id: "point-break",
  title: "Point Break",
  year: 1991,
  genre: ["Action"],
  difficulty: 3,
  emojis: ["🏄", "🏦", "👥", "🕶️"],
  explanation: ["Surfers ride massive waves.", "A gang of bank robbers wears presidential masks.", "An undercover FBI agent infiltrates their crew.", "Their aliases hide behind sunglasses and masks."],
  aliases: []
},
{
  id: "heat",
  title: "Heat",
  year: 1995,
  genre: ["Crime", "Action"],
  difficulty: 3,
  emojis: ["🏦", "🔫", "☕", "🚁"],
  explanation: ["A daring bank heist anchors the plot.", "A massive shootout follows downtown.", "A cop and thief share coffee and mutual respect.", "Helicopters join the citywide manhunt."],
  aliases: []
},
{
  id: "the-fugitive",
  title: "The Fugitive",
  year: 1993,
  genre: ["Thriller", "Action"],
  difficulty: 2,
  emojis: ["🚂", "🏃", "🕵️", "👤"],
  explanation: ["A dramatic train crash sets events in motion.", "A wrongly accused man goes on the run.", "A relentless marshal pursues him.", "He seeks the one-armed man who is truly guilty."],
  aliases: []
},
{
  id: "airplane",
  title: "Airplane!",
  year: 1980,
  genre: ["Comedy"],
  difficulty: 2,
  emojis: ["✈️", "🤦", "😂", "🍲"],
  explanation: ["A commercial flight goes chaotically wrong.", "Deadpan absurdity fuels the jokes.", "Puns and sight gags run throughout.", "Passengers get food poisoning from the fish dinner."],
  aliases: []
},
{
  id: "groundhog-day",
  title: "Groundhog Day",
  year: 1993,
  genre: ["Comedy", "Fantasy"],
  difficulty: 1,
  emojis: ["🦫", "🔁", "⏰", "☔"],
  explanation: ["A groundhog's holiday gives the film its name.", "A weatherman relives the same day endlessly.", "His alarm clock resets the loop each morning.", "Rain and puddles mark the recurring day."],
  aliases: []
},
{
  id: "ferris-bueller",
  title: "Ferris Bueller's Day Off",
  year: 1986,
  genre: ["Comedy"],
  difficulty: 2,
  emojis: ["🏫", "🚗", "🎨", "🎤"],
  explanation: ["A student fakes sick to skip school.", "A borrowed sports car joins the adventure.", "A museum visit fills their day off.", "A show-stopping parade performance steals the show."],
  aliases: []
},
{
  id: "breakfast-club",
  title: "The Breakfast Club",
  year: 1985,
  genre: ["Drama", "Comedy"],
  difficulty: 2,
  emojis: ["🏫", "✍️", "👥", "🤝"],
  explanation: ["Students spend a Saturday in detention.", "They must write an essay about themselves.", "Five very different teens are forced together.", "They ultimately find common ground."],
  aliases: []
},
{
  id: "clueless",
  title: "Clueless",
  year: 1995,
  genre: ["Comedy"],
  difficulty: 2,
  emojis: ["👗", "📱", "🏫", "💕"],
  explanation: ["Fashion obsesses the wealthy protagonist.", "A giant cell phone is a status symbol.", "High school social politics drive the plot.", "A makeover romance plot unfolds."],
  aliases: []
},
{
  id: "mean-girls",
  title: "Mean Girls",
  year: 2004,
  genre: ["Comedy"],
  difficulty: 1,
  emojis: ["📗", "🍽️", "👑", "🌸"],
  explanation: ["A secret 'Burn Book' causes chaos.", "Cafeteria cliques define social status.", "A queen bee rules the school.", "Wednesdays call for wearing pink."],
  aliases: []
},
{
  id: "superbad",
  title: "Superbad",
  year: 2007,
  genre: ["Comedy"],
  difficulty: 2,
  emojis: ["🍺", "🆔", "🚓", "👬"],
  explanation: ["Teens scheme to buy alcohol for a party.", "A fake ID with an odd name causes trouble.", "Chaotic run-ins with police follow.", "Two best friends face growing apart."],
  aliases: []
},
{
  id: "anchorman",
  title: "Anchorman: The Legend of Ron Burgundy",
  year: 2004,
  genre: ["Comedy"],
  difficulty: 2,
  emojis: ["📺", "🎷", "🐻", "👔"],
  explanation: ["A vain local news anchor is the star.", "He plays jazz flute in his spare time.", "He famously fights a bear at the zoo.", "1970s newsroom fashion defines his look."],
  aliases: []
},
{
  id: "dumb-and-dumber",
  title: "Dumb and Dumber",
  year: 1994,
  genre: ["Comedy"],
  difficulty: 2,
  emojis: ["🚐", "🐕", "💰", "🤪"],
  explanation: ["Two friends road-trip in a shaggy van.", "A dog-shaped vehicle carries them cross-country.", "A briefcase of ransom money causes trouble.", "Their obliviousness fuels endless gags."],
  aliases: []
},
{
  id: "big-lebowski",
  title: "The Big Lebowski",
  year: 1998,
  genre: ["Comedy"],
  difficulty: 3,
  emojis: ["🎳", "🥛", "🧺", "🕶️"],
  explanation: ["Bowling defines the Dude's lifestyle.", "White Russians are his drink of choice.", "A soiled rug sets the plot in motion.", "Laid-back style marks his character."],
  aliases: []
},
{
  id: "office-space",
  title: "Office Space",
  year: 1999,
  genre: ["Comedy"],
  difficulty: 2,
  emojis: ["💻", "🖨️", "😑", "💰"],
  explanation: ["Cubicle life crushes the protagonist's spirit.", "A printer becomes an object of rage.", "Corporate monotony defines the tone.", "A software skimming scheme goes wrong."],
  aliases: []
},
{
  id: "monty-python-holy-grail",
  title: "Monty Python and the Holy Grail",
  year: 1975,
  genre: ["Comedy"],
  difficulty: 2,
  emojis: ["🐴", "🏰", "🐇", "⚔️"],
  explanation: ["Knights 'ride' by clopping coconuts, no horses needed.", "A quest for a castle drives the plot.", "A killer rabbit ambushes the knights.", "Absurd sword fights punctuate the comedy."],
  aliases: []
},
{
  id: "princess-bride",
  title: "The Princess Bride",
  year: 1987,
  genre: ["Fantasy", "Comedy"],
  difficulty: 1,
  emojis: ["👸", "🤺", "🧔", "💍"],
  explanation: ["A princess is the object of the quest.", "Swordplay duels define key scenes.", "A giant and a swordsman aid the hero.", "True love drives the entire story."],
  aliases: []
},
{
  id: "willy-wonka",
  title: "Willy Wonka & the Chocolate Factory",
  year: 1971,
  genre: ["Family", "Fantasy"],
  difficulty: 2,
  emojis: ["🍫", "🎟️", "🚣", "👦"],
  explanation: ["A chocolate factory is the setting.", "Golden tickets grant a rare tour.", "A strange boat ride startles the guests.", "A poor boy wins the grand prize."],
  aliases: []
},
{
  id: "wizard-of-oz",
  title: "The Wizard of Oz",
  year: 1939,
  genre: ["Fantasy", "Musical"],
  difficulty: 1,
  emojis: ["👠", "🌪️", "🟨", "🧙"],
  explanation: ["Ruby slippers hold magical power.", "A tornado sweeps Dorothy away.", "A yellow brick road leads her journey.", "The Wizard awaits at the road's end."],
  aliases: []
},
{
  id: "mary-poppins",
  title: "Mary Poppins",
  year: 1964,
  genre: ["Family", "Musical"],
  difficulty: 2,
  emojis: ["☂️", "👩", "🎶", "🏠"],
  explanation: ["An umbrella carries her through the sky.", "A magical nanny arrives to help a family.", "Song and dance fill her adventures.", "She restores joy to the household."],
  aliases: []
},
{
  id: "grease",
  title: "Grease",
  year: 1978,
  genre: ["Musical", "Romance"],
  difficulty: 1,
  emojis: ["🚗", "🎤", "🏫", "🧴"],
  explanation: ["Hot rods define the greaser style.", "Musical numbers punctuate the romance.", "The story centers on a high school romance.", "A leather makeover transforms the ending."],
  aliases: []
},
{
  id: "singin-in-the-rain",
  title: "Singin' in the Rain",
  year: 1952,
  genre: ["Musical", "Comedy"],
  difficulty: 2,
  emojis: ["☔", "💃", "🎬", "😊"],
  explanation: ["A joyful rain-soaked dance is iconic.", "Tap dancing carries much of the story.", "The plot follows Hollywood's shift to sound film.", "Pure joy defines its most famous scene."],
  aliases: []
},
{
  id: "west-side-story",
  title: "West Side Story",
  year: 1961,
  genre: ["Musical", "Romance"],
  difficulty: 3,
  emojis: ["🔪", "💃", "🏙️", "💔"],
  explanation: ["Rival gangs clash with violence.", "Dance numbers express the tension.", "New York City streets set the stage.", "A doomed romance echoes Romeo and Juliet."],
  aliases: []
},
{
  id: "sound-of-music",
  title: "The Sound of Music",
  year: 1965,
  genre: ["Musical", "Family"],
  difficulty: 2,
  emojis: ["🏔️", "🎶", "👩‍👧‍👦", "⛪"],
  explanation: ["Alpine mountains open the film.", "Music defines the family's bond.", "A governess cares for many children.", "Faith and family anchor the story."],
  aliases: []
},
{
  id: "toy-story",
  title: "Toy Story",
  year: 1995,
  genre: ["Animation", "Family"],
  difficulty: 1,
  emojis: ["🤠", "🚀", "🧸", "👦"],
  explanation: ["A cowboy toy is the hero.", "A spaceman toy becomes his rival.", "Toys secretly come to life.", "A boy's room is their whole world."],
  aliases: []
},
{
  id: "finding-nemo",
  title: "Finding Nemo",
  year: 2003,
  genre: ["Animation", "Family"],
  difficulty: 1,
  emojis: ["🐠", "🌊", "🔍", "👨‍👦"],
  explanation: ["A small clownfish is the film's star.", "The ocean is the vast setting.", "A father searches desperately for his son.", "Their bond drives the entire journey."],
  aliases: []
},
{
  id: "monsters-inc",
  title: "Monsters, Inc.",
  year: 2001,
  genre: ["Animation", "Family"],
  difficulty: 1,
  emojis: ["👹", "🚪", "👧", "😱"],
  explanation: ["Monsters power their world with screams.", "Closet doors are portals to children's rooms.", "A little girl accidentally crosses over.", "Fear turns unexpectedly to friendship."],
  aliases: []
},
{
  id: "the-incredibles",
  title: "The Incredibles",
  year: 2004,
  genre: ["Animation", "Superhero"],
  difficulty: 1,
  emojis: ["🦸‍♂️", "🦸‍♀️", "👨‍👩‍👧‍👦", "🎭"],
  explanation: ["A retired superhero longs for action.", "His wife has stretching powers.", "The whole family has secret abilities.", "They must hide their identities from the world."],
  aliases: []
},
{
  id: "ratatouille",
  title: "Ratatouille",
  year: 2007,
  genre: ["Animation", "Family"],
  difficulty: 2,
  emojis: ["🐀", "👨‍🍳", "🍲", "🗼"],
  explanation: ["A rat dreams of cooking.", "He secretly guides a chef.", "Together they create incredible dishes.", "The story is set in Paris."],
  aliases: []
},
{
  id: "wall-e",
  title: "WALL-E",
  year: 2008,
  genre: ["Animation", "Sci-Fi"],
  difficulty: 2,
  emojis: ["🤖", "🗑️", "🌱", "💚"],
  explanation: ["A lonely robot cleans up Earth.", "Mountains of trash cover the planet.", "A single plant offers hope.", "A gentle love story unfolds between robots."],
  aliases: []
},
{
  id: "up",
  title: "Up",
  year: 2009,
  genre: ["Animation", "Family"],
  difficulty: 1,
  emojis: ["🎈", "🏠", "👴", "🐕"],
  explanation: ["Balloons lift a house into the sky.", "The floating house belongs to an old man.", "He seeks one final adventure.", "A talking dog joins his journey."],
  aliases: []
},
{
  id: "inside-out",
  title: "Inside Out",
  year: 2015,
  genre: ["Animation", "Family"],
  difficulty: 2,
  emojis: ["🧠", "😊", "😢", "👧"],
  explanation: ["Emotions run the control room of the mind.", "Joy tries to keep things positive.", "Sadness proves more important than expected.", "A young girl's feelings drive the story."],
  aliases: []
},
{
  id: "coco",
  title: "Coco",
  year: 2017,
  genre: ["Animation", "Family"],
  difficulty: 2,
  emojis: ["💀", "🎸", "👨‍👦", "🌼"],
  explanation: ["The Land of the Dead is vividly depicted.", "Music is forbidden in his family.", "A boy seeks his musical ancestor.", "Marigold petals form a bridge between worlds."],
  aliases: []
},
{
  id: "frozen",
  title: "Frozen",
  year: 2013,
  genre: ["Animation", "Musical"],
  difficulty: 1,
  emojis: ["❄️", "👸", "⛄", "🎶"],
  explanation: ["Ice powers define the story.", "Two royal sisters are at its center.", "A comic snowman joins their journey.", "An anthem about letting go became iconic."],
  aliases: []
},
{
  id: "moana",
  title: "Moana",
  year: 2016,
  genre: ["Animation", "Adventure"],
  difficulty: 2,
  emojis: ["🌊", "⛵", "🐔", "🌋"],
  explanation: ["The ocean itself seems to choose her.", "She sails beyond the reef.", "A dim-witted chicken stows away.", "She must confront a volcanic demon."],
  aliases: []
},
{
  id: "lion-king",
  title: "The Lion King",
  year: 1994,
  genre: ["Animation", "Family"],
  difficulty: 1,
  emojis: ["🦁", "👑", "🌅", "🐗"],
  explanation: ["A lion cub is destined to be king.", "His father rules Pride Rock.", "A famous sunrise opens the film.", "A warthog and meerkat become his friends."],
  aliases: []
},
{
  id: "aladdin",
  title: "Aladdin",
  year: 1992,
  genre: ["Animation", "Fantasy"],
  difficulty: 1,
  emojis: ["🧞", "🪔", "🐒", "🕌"],
  explanation: ["A wish-granting genie changes his fate.", "A magic lamp holds the genie.", "A mischievous monkey is his sidekick.", "The tale unfolds in an Arabian city."],
  aliases: []
},
{
  id: "beauty-and-the-beast",
  title: "Beauty and the Beast",
  year: 1991,
  genre: ["Animation", "Fantasy"],
  difficulty: 1,
  emojis: ["🌹", "🐗", "📚", "🏰"],
  explanation: ["An enchanted rose counts down a curse.", "A beastly prince hides his true self.", "A bookish young woman loves to read.", "The story unfolds in an enchanted castle."],
  aliases: []
},
{
  id: "little-mermaid",
  title: "The Little Mermaid",
  year: 1989,
  genre: ["Animation", "Fantasy"],
  difficulty: 1,
  emojis: ["🧜‍♀️", "🎤", "🦀", "🌊"],
  explanation: ["A mermaid longs for legs.", "She trades her voice for a chance on land.", "A crab sidekick offers comic relief.", "The sea is her original home."],
  aliases: []
},
{
  id: "mulan",
  title: "Mulan",
  year: 1998,
  genre: ["Animation", "Adventure"],
  difficulty: 2,
  emojis: ["⚔️", "👘", "🐉", "🎖️"],
  explanation: ["She disguises herself as a soldier.", "Traditional dress hides her identity at first.", "A small dragon guides and protects her.", "She earns honor through her bravery."],
  aliases: []
},
{
  id: "lilo-and-stitch",
  title: "Lilo & Stitch",
  year: 2002,
  genre: ["Animation", "Family"],
  difficulty: 2,
  emojis: ["👽", "🌺", "👧", "🌊"],
  explanation: ["An alien crash-lands on Earth.", "Hawaii is the tropical setting.", "A lonely girl adopts him as a pet.", "Ohana means family in their story."],
  aliases: []
},
{
  id: "shrek",
  title: "Shrek",
  year: 2001,
  genre: ["Animation", "Comedy"],
  difficulty: 1,
  emojis: ["👹", "🧅", "🐴", "🏰"],
  explanation: ["A grumpy ogre lives alone in a swamp.", "He compares himself to an onion, full of layers.", "A talking donkey becomes his companion.", "He must rescue a princess from a tower."],
  aliases: []
},
{
  id: "kung-fu-panda",
  title: "Kung Fu Panda",
  year: 2008,
  genre: ["Animation", "Comedy"],
  difficulty: 2,
  emojis: ["🐼", "🥋", "🍜", "🐉"],
  explanation: ["A clumsy panda dreams of kung fu.", "He unexpectedly becomes a warrior.", "Noodles are his family's business.", "He must master an ancient scroll."],
  aliases: []
},
{
  id: "how-to-train-dragon",
  title: "How to Train Your Dragon",
  year: 2010,
  genre: ["Animation", "Family"],
  difficulty: 2,
  emojis: ["🐉", "🛠️", "🛡️", "👦"],
  explanation: ["A dragon becomes an unlikely friend.", "A boy builds it a prosthetic tailfin.", "Vikings traditionally fight dragons.", "Their bond changes both species forever."],
  aliases: []
},
{
  id: "spirited-away",
  title: "Spirited Away",
  year: 2001,
  genre: ["Animation", "Fantasy"],
  difficulty: 3,
  emojis: ["🛁", "👻", "🐷", "🚪"],
  explanation: ["A magical bathhouse serves spirits.", "Ghostly beings populate its halls.", "Her parents are transformed into pigs.", "A mysterious door leads to another world."],
  aliases: []
},
{
  id: "my-neighbor-totoro",
  title: "My Neighbor Totoro",
  year: 1988,
  genre: ["Animation", "Family"],
  difficulty: 3,
  emojis: ["🌳", "🐱", "☂️", "🌧️"],
  explanation: ["A forest spirit lives in a giant tree.", "A cat-shaped bus is a magical vehicle.", "An umbrella is shared in the rain.", "Rural Japan sets the gentle story."],
  aliases: []
},
{
  id: "akira",
  title: "Akira",
  year: 1988,
  genre: ["Animation", "Sci-Fi"],
  difficulty: 4,
  emojis: ["🏍️", "💥", "🧒", "🌆"],
  explanation: ["A red motorcycle is instantly iconic.", "Psychic powers cause explosive destruction.", "A child holds immense hidden power.", "Neo-Tokyo is the dystopian setting."],
  aliases: []
},
{
  id: "iron-giant",
  title: "The Iron Giant",
  year: 1999,
  genre: ["Animation", "Sci-Fi"],
  difficulty: 2,
  emojis: ["🤖", "👦", "🚀", "💚"],
  explanation: ["A giant robot falls from the sky.", "A young boy befriends it.", "It is mistaken for a weapon.", "It ultimately chooses kindness over destruction."],
  aliases: []
},
{
  id: "coraline",
  title: "Coraline",
  year: 2009,
  genre: ["Animation", "Fantasy"],
  difficulty: 3,
  emojis: ["🔑", "🚪", "🪡", "👧"],
  explanation: ["A small key unlocks a hidden world.", "A tiny door leads there.", "Button eyes mark her sinister other parents.", "A curious girl explores the danger."],
  aliases: []
},
{
  id: "nightmare-before-christmas",
  title: "The Nightmare Before Christmas",
  year: 1993,
  genre: ["Animation", "Fantasy"],
  difficulty: 2,
  emojis: ["🎃", "🎄", "👑", "💀"],
  explanation: ["Halloween Town is the main setting.", "He tries to take over Christmas instead.", "He is the pumpkin king of his world.", "A skeletal hero leads the story."],
  aliases: []
},
{
  id: "who-framed-roger-rabbit",
  title: "Who Framed Roger Rabbit",
  year: 1988,
  genre: ["Comedy", "Animation"],
  difficulty: 3,
  emojis: ["🐰", "🕵️", "🎨", "🔫"],
  explanation: ["A cartoon rabbit is accused of murder.", "A human detective investigates the case.", "Animation and live action blend together.", "A frame-up drives the entire mystery."],
  aliases: []
},
{
  id: "home-alone",
  title: "Home Alone",
  year: 1990,
  genre: ["Comedy", "Family"],
  difficulty: 1,
  emojis: ["🏠", "👦", "🧨", "🎄"],
  explanation: ["A house becomes a battleground.", "A boy is left behind by his family.", "Booby traps foil the burglars.", "The story takes place at Christmas."],
  aliases: []
},
{
  id: "mrs-doubtfire",
  title: "Mrs. Doubtfire",
  year: 1993,
  genre: ["Comedy"],
  difficulty: 2,
  emojis: ["👨", "👵", "👶", "🏠"],
  explanation: ["A father disguises himself in costume.", "He poses as an elderly housekeeper.", "The ruse lets him stay near his kids.", "Family reunites at the heart of the story."],
  aliases: []
},
{
  id: "beetlejuice",
  title: "Beetlejuice",
  year: 1988,
  genre: ["Comedy", "Horror"],
  difficulty: 3,
  emojis: ["👻", "🪱", "3️⃣", "🏚️"],
  explanation: ["A ghostly couple haunts their old home.", "A sandworm inhabits the afterlife's landscape.", "Saying his name three times summons him.", "A haunted house sets the entire tone."],
  aliases: []
},
{
  id: "edward-scissorhands",
  title: "Edward Scissorhands",
  year: 1990,
  genre: ["Fantasy", "Romance"],
  difficulty: 3,
  emojis: ["✂️", "🖤", "🏘️", "❄️"],
  explanation: ["Scissors replace his hands.", "A gentle, dark soul defines his character.", "Pastel suburbia contrasts his strangeness.", "He famously sculpts ice into delicate shapes."],
  aliases: []
},
{
  id: "batman-1989",
  title: "Batman",
  year: 1989,
  genre: ["Superhero", "Action"],
  difficulty: 2,
  emojis: ["🦇", "🃏", "🌃", "🚗"],
  explanation: ["A bat-themed vigilante protects the city.", "The Joker is his chaotic nemesis.", "Gotham's dark streets set the mood.", "The Batmobile roars into action."],
  aliases: []
},
{
  id: "dark-knight",
  title: "The Dark Knight",
  year: 2008,
  genre: ["Superhero", "Action"],
  difficulty: 1,
  emojis: ["🦇", "🃏", "🎭", "🚛"],
  explanation: ["The Batman faces his greatest challenge.", "The Joker sows anarchy throughout Gotham.", "Moral choices and masks recur as themes.", "A truck is famously flipped mid-chase."],
  aliases: []
},
{
  id: "superman-1978",
  title: "Superman",
  year: 1978,
  genre: ["Superhero"],
  difficulty: 2,
  emojis: ["🦸", "🌽", "📰", "💙"],
  explanation: ["A superpowered alien protects Earth.", "He grew up on a Kansas farm.", "He works as a mild-mannered reporter.", "His costume's colors are iconic."],
  aliases: []
},
{
  id: "spider-man-2002",
  title: "Spider-Man",
  year: 2002,
  genre: ["Superhero"],
  difficulty: 1,
  emojis: ["🕷️", "🕸️", "📸", "🏙️"],
  explanation: ["A spider bite grants him powers.", "He swings through the city on webs.", "He moonlights as a photographer.", "New York City is his home turf."],
  aliases: []
},
{
  id: "spider-man-2",
  title: "Spider-Man 2",
  year: 2004,
  genre: ["Superhero"],
  difficulty: 2,
  emojis: ["🕷️", "☀️", "🚂", "💔"],
  explanation: ["Peter Parker balances hero life and school.", "A scientist's arms fuse to his body.", "A train rescue is a standout sequence.", "His romantic struggles deepen in this sequel."],
  aliases: []
},
{
  id: "iron-man",
  title: "Iron Man",
  year: 2008,
  genre: ["Superhero", "Action"],
  difficulty: 1,
  emojis: ["🤖", "💰", "⚙️", "❤️"],
  explanation: ["A high-tech armored suit is his power.", "A billionaire industrialist builds it.", "He constructs it while held captive.", "A glowing core keeps him alive."],
  aliases: []
},
{
  id: "the-avengers",
  title: "The Avengers",
  year: 2012,
  genre: ["Superhero", "Action"],
  difficulty: 1,
  emojis: ["🦸‍♂️", "🛡️", "⚡", "🌀"],
  explanation: ["Superheroes team up for the first time.", "A patriotic soldier leads the charge.", "A god of thunder joins the fight.", "A portal unleashes an alien invasion."],
  aliases: []
},
{
  id: "guardians-galaxy",
  title: "Guardians of the Galaxy",
  year: 2014,
  genre: ["Superhero", "Sci-Fi"],
  difficulty: 2,
  emojis: ["🚀", "🦝", "🌳", "🎵"],
  explanation: ["Misfits band together in space.", "A wisecracking raccoon is among them.", "A tree-like being says little but means much.", "A mixtape of classic songs defines the tone."],
  aliases: []
},
{
  id: "black-panther",
  title: "Black Panther",
  year: 2018,
  genre: ["Superhero", "Action"],
  difficulty: 2,
  emojis: ["🐆", "👑", "⚡", "🌍"],
  explanation: ["A hero takes on a panther-themed mantle.", "He inherits his nation's throne.", "Vibranium powers incredible technology.", "A hidden African kingdom is the setting."],
  aliases: []
},
{
  id: "logan",
  title: "Logan",
  year: 2017,
  genre: ["Superhero", "Drama"],
  difficulty: 3,
  emojis: ["🗡️", "👴", "👧", "🚗"],
  explanation: ["Retractable claws define his powers.", "He is now aging and weary.", "A young girl shares his abilities.", "A road trip forms the heart of the story."],
  aliases: []
},
{
  id: "deadpool",
  title: "Deadpool",
  year: 2016,
  genre: ["Superhero", "Comedy"],
  difficulty: 2,
  emojis: ["🔴", "😷", "🗡️", "😂"],
  explanation: ["A red suit defines his costume.", "Scarring hides beneath his mask.", "He fights with a pair of swords.", "Fourth-wall-breaking jokes fill the film."],
  aliases: []
},
{
  id: "wonder-woman",
  title: "Wonder Woman",
  year: 2017,
  genre: ["Superhero", "Action"],
  difficulty: 2,
  emojis: ["🛡️", "⚔️", "🏝️", "👸"],
  explanation: ["A shield and lasso define her gear.", "She trains as a warrior from birth.", "An island of Amazons is her home.", "Royal heritage shapes her destiny."],
  aliases: []
},
{
  id: "spider-verse",
  title: "Spider-Man: Into the Spider-Verse",
  year: 2018,
  genre: ["Superhero", "Animation"],
  difficulty: 2,
  emojis: ["🕷️", "🎨", "🌀", "🕸️"],
  explanation: ["A new hero takes up the mantle.", "A bold comic-book art style defines it.", "A dimensional portal brings other Spider-people.", "Web-slinging connects them all."],
  aliases: []
},
{
  id: "avengers-endgame",
  title: "Avengers: Endgame",
  year: 2019,
  genre: ["Superhero", "Action"],
  difficulty: 1,
  emojis: ["🧤", "🌌", "⏳", "💔"],
  explanation: ["A powerful gauntlet holds cosmic stones.", "Half the universe vanishes.", "Time travel offers a desperate solution.", "Heavy sacrifice defines the finale."],
  aliases: []
},
{
  id: "harry-potter-1",
  title: "Harry Potter and the Sorcerer's Stone",
  year: 2001,
  genre: ["Fantasy", "Family"],
  difficulty: 1,
  emojis: ["⚡", "🧙", "🦉", "🏰"],
  explanation: ["A lightning-shaped scar marks him.", "He discovers he is a wizard.", "Owls deliver mail to the wizarding world.", "A magical castle school is the setting."],
  aliases: ["harry potter and the philosopher's stone"]
},
{
  id: "fellowship-of-the-ring",
  title: "The Lord of the Rings: The Fellowship of the Ring",
  year: 2001,
  genre: ["Fantasy", "Adventure"],
  difficulty: 2,
  emojis: ["💍", "🧙", "🌋", "👣"],
  explanation: ["A powerful ring must be destroyed.", "A wise wizard guides the quest.", "It must be thrown into a distant volcano.", "Small-footed hobbits carry the burden."],
  aliases: ["lotr fellowship", "fellowship of the ring"]
},
{
  id: "pirates-caribbean",
  title: "Pirates of the Caribbean: The Curse of the Black Pearl",
  year: 2003,
  genre: ["Adventure", "Fantasy"],
  difficulty: 2,
  emojis: ["🏴‍☠️", "⚓", "👻", "🦜"],
  explanation: ["Pirates sail the Caribbean seas.", "A ship named the Black Pearl is central.", "A curse turns the crew into skeletons by moonlight.", "A parrot accompanies one memorable pirate."],
  aliases: ["pirates of the caribbean"]
},
{
  id: "the-mummy-1999",
  title: "The Mummy",
  year: 1999,
  genre: ["Adventure", "Horror"],
  difficulty: 2,
  emojis: ["🏺", "🐫", "💀", "🏜️"],
  explanation: ["Ancient artifacts hold a curse.", "Camels cross the desert setting.", "A reanimated mummy seeks vengeance.", "Egypt's sands set the adventure's stage."],
  aliases: []
},
{
  id: "gladiator",
  title: "Gladiator",
  year: 2000,
  genre: ["Action", "Drama"],
  difficulty: 2,
  emojis: ["⚔️", "🏛️", "🦁", "👑"],
  explanation: ["A general becomes a slave-turned-fighter.", "The Colosseum is the arena of his fate.", "He battles fierce beasts for the crowd.", "He seeks vengeance against a corrupt emperor."],
  aliases: []
},
{
  id: "braveheart",
  title: "Braveheart",
  year: 1995,
  genre: ["Action", "Drama"],
  difficulty: 3,
  emojis: ["🏴󠁧󠁢󠁳󠁣󠁴󠁿", "⚔️", "🎨", "🗡️"],
  explanation: ["A Scottish rebellion drives the story.", "Sword battles fill the film.", "Blue face paint marks the warriors.", "Freedom is the rallying cry throughout."],
  aliases: []
},
{
  id: "saving-private-ryan",
  title: "Saving Private Ryan",
  year: 1998,
  genre: ["War", "Drama"],
  difficulty: 2,
  emojis: ["🏖️", "🎖️", "🪖", "🇺🇸"],
  explanation: ["A brutal beach landing opens the film.", "Soldiers search for one missing man.", "World War II is the historical backdrop.", "American troops undertake the dangerous mission."],
  aliases: []
},
{
  id: "apocalypse-now",
  title: "Apocalypse Now",
  year: 1979,
  genre: ["War", "Drama"],
  difficulty: 3,
  emojis: ["🚤", "🌴", "🔥", "🎖️"],
  explanation: ["A river journey structures the plot.", "The Vietnamese jungle is the setting.", "Napalm and fire dominate its imagery.", "A soldier is sent to find a rogue colonel."],
  aliases: []
},
{
  id: "full-metal-jacket",
  title: "Full Metal Jacket",
  year: 1987,
  genre: ["War", "Drama"],
  difficulty: 3,
  emojis: ["🪖", "😤", "🎯", "🇻🇳"],
  explanation: ["Marine boot camp is brutally depicted.", "A drill sergeant terrorizes recruits.", "Sniper training becomes deadly reality.", "The Vietnam War is the backdrop."],
  aliases: []
},
{
  id: "platoon",
  title: "Platoon",
  year: 1986,
  genre: ["War", "Drama"],
  difficulty: 3,
  emojis: ["🪖", "🌴", "⚔️", "💭"],
  explanation: ["A young soldier is thrust into combat.", "The Vietnamese jungle sets the mood.", "Moral conflict divides his fellow soldiers.", "Internal narration reflects his inner turmoil."],
  aliases: []
},
{
  id: "schindlers-list",
  title: "Schindler's List",
  year: 1993,
  genre: ["Drama", "War"],
  difficulty: 3,
  emojis: ["🏭", "📜", "🕯️", "⚫"],
  explanation: ["A factory becomes an unlikely refuge.", "A list of names determines survival.", "Candlelight recurs as a symbol of hope.", "The film is shot largely in black and white."],
  aliases: []
},
{
  id: "forrest-gump",
  title: "Forrest Gump",
  year: 1994,
  genre: ["Drama", "Comedy"],
  difficulty: 1,
  emojis: ["🏃", "🍫", "🪶", "💌"],
  explanation: ["Running defines much of his life.", "A box of chocolates opens his story.", "A floating feather bookends the film.", "His letters to Jenny recur throughout."],
  aliases: []
},
{
  id: "truman-show",
  title: "The Truman Show",
  year: 1998,
  genre: ["Drama", "Comedy"],
  difficulty: 2,
  emojis: ["📺", "🌊", "🚪", "☀️"],
  explanation: ["His entire life is broadcast on television.", "An artificial sea bounds his world.", "A hidden door leads out of the set.", "A painted sun lights his fake sky."],
  aliases: []
},
{
  id: "cast-away",
  title: "Cast Away",
  year: 2000,
  genre: ["Drama", "Adventure"],
  difficulty: 2,
  emojis: ["🏝️", "🏐", "✈️", "📦"],
  explanation: ["He is stranded alone on an island.", "A volleyball becomes his only companion.", "A plane crash strands him there.", "Undelivered packages wash up with him."],
  aliases: []
},
{
  id: "apollo-13",
  title: "Apollo 13",
  year: 1995,
  genre: ["Drama"],
  difficulty: 2,
  emojis: ["🚀", "🌕", "🆘", "🛠️"],
  explanation: ["A doomed lunar mission is the subject.", "The moon landing is aborted mid-flight.", "A famous distress call defines the crisis.", "The crew improvises repairs to survive."],
  aliases: []
},
{
  id: "good-will-hunting",
  title: "Good Will Hunting",
  year: 1997,
  genre: ["Drama"],
  difficulty: 2,
  emojis: ["🧮", "🧹", "🧠", "💬"],
  explanation: ["A hallway chalkboard poses a genius problem.", "A janitor secretly solves it.", "His brilliant mind goes unrecognized.", "Therapy sessions unlock his emotional walls."],
  aliases: []
},
{
  id: "dead-poets-society",
  title: "Dead Poets Society",
  year: 1989,
  genre: ["Drama"],
  difficulty: 2,
  emojis: ["📚", "🕯️", "🎓", "🪑"],
  explanation: ["Poetry inspires a classroom of boys.", "A secret club meets by candlelight.", "A boarding school sets the story.", "Students famously stand on their desks."],
  aliases: []
},
{
  id: "cuckoos-nest",
  title: "One Flew Over the Cuckoo's Nest",
  year: 1975,
  genre: ["Drama"],
  difficulty: 3,
  emojis: ["🏥", "😤", "🛋️", "🪶"],
  explanation: ["A mental institution is the setting.", "A rebellious patient defies the staff.", "A stern nurse rules the ward.", "A pillow closes the story's tragic ending."],
  aliases: []
},
{
  id: "taxi-driver",
  title: "Taxi Driver",
  year: 1976,
  genre: ["Drama", "Crime"],
  difficulty: 3,
  emojis: ["🚕", "🌃", "🔫", "🪞"],
  explanation: ["A cab driver roams the city at night.", "Nighttime New York sets the mood.", "He arms himself for violent confrontation.", "A mirror monologue is iconic."],
  aliases: []
},
{
  id: "amadeus",
  title: "Amadeus",
  year: 1984,
  genre: ["Drama"],
  difficulty: 3,
  emojis: ["🎼", "🎹", "😡", "👑"],
  explanation: ["A brilliant composer's music defines the era.", "Piano and orchestral works fill the film.", "A jealous rival despises his talent.", "Vienna's royal court is the backdrop."],
  aliases: []
},
{
  id: "social-network",
  title: "The Social Network",
  year: 2010,
  genre: ["Drama"],
  difficulty: 2,
  emojis: ["💻", "👥", "⚖️", "📱"],
  explanation: ["A dorm-room website becomes a global platform.", "Friendships fracture over its creation.", "Lawsuits follow its explosive success.", "It becomes the social network we know today."],
  aliases: []
},
{
  id: "whiplash",
  title: "Whiplash",
  year: 2014,
  genre: ["Drama", "Music"],
  difficulty: 2,
  emojis: ["🥁", "🎼", "😡", "🩸"],
  explanation: ["A driven drummer pushes himself to the limit.", "A jazz band is his battleground.", "An abusive instructor torments him.", "Bleeding hands show his relentless practice."],
  aliases: []
},
{
  id: "parasite",
  title: "Parasite",
  year: 2019,
  genre: ["Drama", "Thriller"],
  difficulty: 2,
  emojis: ["🏠", "🪜", "🌧️", "🪳"],
  explanation: ["A wealthy family's house is the setting.", "A hidden basement holds a secret.", "Flooding devastates a poorer neighborhood.", "Class divides drive the entire plot."],
  aliases: []
},
{
  id: "everything-everywhere",
  title: "Everything Everywhere All at Once",
  year: 2022,
  genre: ["Sci-Fi", "Comedy"],
  difficulty: 2,
  emojis: ["🌀", "🥨", "🐕", "🧾"],
  explanation: ["Parallel universes collide chaotically.", "Absurd objects become powers, even a hot dog world.", "A googly-eyed rock appears memorably.", "A tax audit sparks the entire adventure."],
  aliases: []
},
{
  id: "get-out",
  title: "Get Out",
  year: 2017,
  genre: ["Horror", "Thriller"],
  difficulty: 2,
  emojis: ["☕", "🌀", "🧠", "🏡"],
  explanation: ["A teacup and spoon trigger a hypnotic trance.", "A sunken place traps victims' minds.", "Bodies are taken over against their will.", "A visit to meet the family turns sinister."],
  aliases: []
},
{
  id: "hereditary",
  title: "Hereditary",
  year: 2018,
  genre: ["Horror"],
  difficulty: 3,
  emojis: ["🏚️", "👵", "🕯️", "🪑"],
  explanation: ["A family home hides dark secrets.", "A grandmother's death opens the story.", "Cult rituals emerge with candlelight.", "A miniature dollhouse mirrors the real horror."],
  aliases: []
},
{
  id: "midsommar",
  title: "Midsommar",
  year: 2019,
  genre: ["Horror"],
  difficulty: 3,
  emojis: ["🌻", "☀️", "👗", "🔥"],
  explanation: ["Flower crowns mark the festival.", "The horror unfolds in constant daylight.", "A white ceremonial dress plays a key role.", "Fire provides a disturbing final image."],
  aliases: []
},
{
  id: "interstellar",
  title: "Interstellar",
  year: 2014,
  genre: ["Sci-Fi", "Drama"],
  difficulty: 2,
  emojis: ["🌾", "🚀", "⏳", "🕳️"],
  explanation: ["A dying cornfield opens the story on Earth.", "A crew launches to find a new home.", "Time moves differently for those who travel.", "A wormhole provides their path through space."],
  aliases: []
},
{
  id: "inception",
  title: "Inception",
  year: 2010,
  genre: ["Sci-Fi", "Thriller"],
  difficulty: 2,
  emojis: ["🌀", "🎡", "🔝", "💭"],
  explanation: ["Dreams within dreams structure the plot.", "A spinning top may reveal reality.", "The device never quite stops spinning.", "Ideas are planted deep in someone's mind."],
  aliases: []
},
{
  id: "arrival",
  title: "Arrival",
  year: 2016,
  genre: ["Sci-Fi", "Drama"],
  difficulty: 3,
  emojis: ["🛸", "🐙", "⭕", "⏳"],
  explanation: ["Massive alien ships appear on Earth.", "Octopus-like aliens communicate in symbols.", "Circular symbols form their written language.", "Time is experienced non-linearly by the end."],
  aliases: []
},
{
  id: "ex-machina",
  title: "Ex Machina",
  year: 2014,
  genre: ["Sci-Fi", "Thriller"],
  difficulty: 3,
  emojis: ["🤖", "🧠", "🏠", "👁️"],
  explanation: ["An android is the film's central test subject.", "Artificial intelligence is the driving theme.", "An isolated research house sets the scene.", "A Turing test observes her responses."],
  aliases: []
},
{
  id: "mad-max-fury-road",
  title: "Mad Max: Fury Road",
  year: 2015,
  genre: ["Action", "Sci-Fi"],
  difficulty: 2,
  emojis: ["🏜️", "🚗", "🔥", "👩"],
  explanation: ["A wasteland desert is the setting.", "Modified war vehicles chase across it.", "Flame and fury define the action.", "A fierce rebel leader drives much of the plot."],
  aliases: []
},
{
  id: "dune-2021",
  title: "Dune",
  year: 2021,
  genre: ["Sci-Fi"],
  difficulty: 2,
  emojis: ["🏜️", "🐛", "👑", "💧"],
  explanation: ["A vast desert planet is the setting.", "Giant sandworms roam beneath the surface.", "A noble house rules the spice trade.", "Water is the planet's most precious resource."],
  aliases: ["dune part one"]
},
{
  id: "oppenheimer",
  title: "Oppenheimer",
  year: 2023,
  genre: ["Drama", "History"],
  difficulty: 2,
  emojis: ["💣", "🔬", "☢️", "🕶️"],
  explanation: ["A devastating weapon is developed.", "Scientific research drives the plot.", "Nuclear power is the central subject.", "A brilliant physicist leads the effort."],
  aliases: []
},
{
  id: "barbie",
  title: "Barbie",
  year: 2023,
  genre: ["Comedy", "Fantasy"],
  difficulty: 1,
  emojis: ["👱‍♀️", "💗", "🏖️", "👠"],
  explanation: ["A doll comes to life in her world.", "Pink dominates every frame.", "Her plastic beach has no real water.", "High heels define her permanent stance."],
  aliases: []
},
{
  id: "knives-out",
  title: "Knives Out",
  year: 2019,
  genre: ["Mystery"],
  difficulty: 2,
  emojis: ["🔪", "🕵️", "💰", "👨‍👩‍👧‍👦"],
  explanation: ["A knife display looms behind the detective.", "A folksy sleuth investigates a death.", "A fortune is at stake in the will.", "A dysfunctional family hides many secrets."],
  aliases: []
},
{
  id: "grand-budapest-hotel",
  title: "The Grand Budapest Hotel",
  year: 2014,
  genre: ["Comedy", "Drama"],
  difficulty: 3,
  emojis: ["🏨", "🔑", "🎨", "📦"],
  explanation: ["A grand European hotel is the setting.", "A concierge holds many secret keys.", "Symmetrical, colorful visuals define the style.", "A stolen painting drives the caper plot."],
  aliases: []
},
{
  id: "eternal-sunshine",
  title: "Eternal Sunshine of the Spotless Mind",
  year: 2004,
  genre: ["Romance", "Sci-Fi"],
  difficulty: 3,
  emojis: ["🧠", "💑", "❄️", "🗑️"],
  explanation: ["Memories can be erased from the mind.", "A troubled couple undergoes the procedure.", "A snowy beach recurs in memory.", "Deleted memories fade like discarded files."],
  aliases: []
},
{
  id: "little-miss-sunshine",
  title: "Little Miss Sunshine",
  year: 2006,
  genre: ["Comedy", "Drama"],
  difficulty: 2,
  emojis: ["🚐", "👑", "💃", "👨‍👩‍👧‍👦"],
  explanation: ["A yellow VW van carries the family.", "A children's beauty pageant is their destination.", "An unconventional dance routine steals the show.", "A dysfunctional family bonds along the way."],
  aliases: []
},
{
  id: "napoleon-dynamite",
  title: "Napoleon Dynamite",
  year: 2004,
  genre: ["Comedy"],
  difficulty: 3,
  emojis: ["🦙", "💃", "🥔", "🗳️"],
  explanation: ["A pet llama lives on the farm.", "An awkward dance solo becomes iconic.", "Tater tots are a recurring snack.", "A school election drives part of the plot."],
  aliases: []
},
{
  id: "the-graduate",
  title: "The Graduate",
  year: 1967,
  genre: ["Comedy", "Drama"],
  difficulty: 3,
  emojis: ["🎓", "🏊", "👩", "💒"],
  explanation: ["A recent graduate feels adrift.", "A swimming pool symbolizes his aimlessness.", "An older woman seduces him.", "A wedding-crashing finale closes the film."],
  aliases: []
},
{
  id: "some-like-it-hot",
  title: "Some Like It Hot",
  year: 1959,
  genre: ["Comedy"],
  difficulty: 3,
  emojis: ["🎷", "👗", "🚂", "💋"],
  explanation: ["Musicians flee after witnessing a crime.", "They disguise themselves as women.", "A train carries an all-female band.", "Romance complicates their disguise."],
  aliases: []
},
{
  id: "casablanca",
  title: "Casablanca",
  year: 1942,
  genre: ["Romance", "Drama"],
  difficulty: 2,
  emojis: ["✈️", "🍷", "🎹", "💔"],
  explanation: ["Letters of transit promise escape by plane.", "A nightclub bar is the central setting.", "A piano player performs their song.", "Old flames reunite under wartime pressure."],
  aliases: []
},
{
  id: "gone-with-the-wind",
  title: "Gone with the Wind",
  year: 1939,
  genre: ["Romance", "Drama"],
  difficulty: 3,
  emojis: ["🏡", "🔥", "👗", "💔"],
  explanation: ["A Southern plantation anchors the story.", "War burns the old world to the ground.", "Elaborate gowns mark the era's style.", "A turbulent romance spans years of conflict."],
  aliases: []
},
{
  id: "citizen-kane",
  title: "Citizen Kane",
  year: 1941,
  genre: ["Drama", "Mystery"],
  difficulty: 3,
  emojis: ["🛷", "📰", "🏰", "🗞️"],
  explanation: ["A childhood sled holds the story's secret.", "A publishing tycoon builds his empire.", "An enormous mansion reflects his isolation.", "A single dying word drives the mystery."],
  aliases: []
},
{
  id: "north-by-northwest",
  title: "North by Northwest",
  year: 1959,
  genre: ["Thriller"],
  difficulty: 3,
  emojis: ["✈️", "🌽", "🗻", "🕴️"],
  explanation: ["A crop-duster plane chases him across a field.", "Farmland becomes an unlikely battleground.", "Mount Rushmore hosts the climax.", "A mistaken identity spirals into danger."],
  aliases: []
},
{
  id: "vertigo",
  title: "Vertigo",
  year: 1958,
  genre: ["Thriller"],
  difficulty: 3,
  emojis: ["🌀", "🏢", "😵", "💍"],
  explanation: ["A spinning visual effect defines his fear.", "Bell towers trigger his phobia.", "Obsession consumes the protagonist.", "A mysterious woman may not be who she seems."],
  aliases: []
},
{
  id: "rear-window",
  title: "Rear Window",
  year: 1954,
  genre: ["Thriller"],
  difficulty: 3,
  emojis: ["🔭", "🪟", "📷", "🦵"],
  explanation: ["A neighbor is watched through binoculars.", "An apartment courtyard is the whole setting.", "A photographer suspects a murder.", "His broken leg confines him to a wheelchair."],
  aliases: []
},
{
  id: "the-birds",
  title: "The Birds",
  year: 1963,
  genre: ["Horror", "Thriller"],
  difficulty: 3,
  emojis: ["🐦", "🏘️", "👩", "😱"],
  explanation: ["Birds inexplicably turn violent.", "A small coastal town is under siege.", "A visiting woman becomes entangled in the terror.", "No explanation for the attacks is ever given."],
  aliases: []
},
{
  id: "2010-black-swan",
  title: "Black Swan",
  year: 2010,
  genre: ["Drama", "Thriller"],
  difficulty: 3,
  emojis: ["🩰", "🦢", "🪞", "🖤"],
  explanation: ["Ballet dominates the story.", "A swan role symbolizes duality.", "Mirrors reflect her fracturing mind.", "Darkness overtakes her perfectionism."],
  aliases: []
},
{
  id: "no-country-old-men",
  title: "No Country for Old Men",
  year: 2007,
  genre: ["Thriller", "Crime"],
  difficulty: 3,
  emojis: ["💰", "🔫", "🪙", "🤠"],
  explanation: ["A satchel of drug money is found.", "A relentless killer hunts it down.", "A coin flip decides life or death.", "A weary sheriff pursues the trail."],
  aliases: []
},
{
  id: "there-will-be-blood",
  title: "There Will Be Blood",
  year: 2007,
  genre: ["Drama"],
  difficulty: 3,
  emojis: ["🛢️", "⛏️", "⛪", "🥤"],
  explanation: ["Oil drilling builds his fortune.", "He digs relentlessly for wealth.", "A rival preacher opposes him.", "A famous line involves drinking his rival's milkshake."],
  aliases: []
},
{
  id: "the-departed",
  title: "The Departed",
  year: 2006,
  genre: ["Crime", "Thriller"],
  difficulty: 3,
  emojis: ["👮", "🕴️", "📱", "🐀"],
  explanation: ["An undercover cop infiltrates the mob.", "A mob mole infiltrates the police.", "Phones become key to exposing both.", "A rat symbolizes the hidden informants."],
  aliases: []
},
{
  id: "django-unchained",
  title: "Django Unchained",
  year: 2012,
  genre: ["Western", "Drama"],
  difficulty: 2,
  emojis: ["⛓️", "🤠", "🔫", "🩸"],
  explanation: ["A freed slave seeks vengeance.", "He rides as a bounty hunter.", "Gunfights punctuate his journey.", "Bloody violence marks the finale."],
  aliases: []
},
{
  id: "good-bad-ugly",
  title: "The Good, the Bad and the Ugly",
  year: 1966,
  genre: ["Western"],
  difficulty: 3,
  emojis: ["🤠", "💰", "⚰️", "🎵"],
  explanation: ["Three gunslingers hunt buried treasure.", "Gold drives their uneasy alliance.", "A cemetery hosts the final standoff.", "A whistling theme underscores the tension."],
  aliases: []
},
{
  id: "unforgiven",
  title: "Unforgiven",
  year: 1992,
  genre: ["Western"],
  difficulty: 3,
  emojis: ["🤠", "🔫", "🐎", "🌧️"],
  explanation: ["A retired gunslinger returns to violence.", "He seeks bounty on wanted men.", "He rides once more into danger.", "Rain-soaked gloom colors the finale."],
  aliases: []
},
{
  id: "the-wizard-1985-back",
  title: "Back to the Future Part II",
  year: 1989,
  genre: ["Sci-Fi", "Comedy"],
  difficulty: 2,
  emojis: ["🚗", "🛹", "👟", "📅"],
  explanation: ["The time-traveling car returns.", "A hoverboard replaces the skateboard.", "Self-lacing shoes appear in the future.", "The plot jumps to the year 2015."],
  aliases: []
},
{
  id: "jurassic-park-lost-world",
  title: "The Lost World: Jurassic Park",
  year: 1997,
  genre: ["Adventure", "Sci-Fi"],
  difficulty: 2,
  emojis: ["🦖", "🏝️", "🚁", "🌴"],
  explanation: ["Dinosaurs again threaten the humans.", "A second island holds the creatures.", "Helicopters ferry the new expedition.", "Dense jungle hides new dangers."],
  aliases: []
},
{
  id: "king-kong-2005",
  title: "King Kong",
  year: 2005,
  genre: ["Adventure", "Fantasy"],
  difficulty: 2,
  emojis: ["🦍", "🏙️", "✈️", "👸"],
  explanation: ["A giant ape is captured and displayed.", "He is brought to a modern city.", "Planes attack him atop a skyscraper.", "A woman becomes an unlikely bond for him."],
  aliases: []
},
{
  id: "jumanji-1995",
  title: "Jumanji",
  year: 1995,
  genre: ["Adventure", "Fantasy"],
  difficulty: 2,
  emojis: ["🎲", "🦁", "🌴", "🏠"],
  explanation: ["A magical board game unleashes chaos.", "Wild animals invade the real world.", "The jungle overtakes an ordinary house.", "Rolling the dice brings new dangers."],
  aliases: []
},
{
  id: "night-at-the-museum",
  title: "Night at the Museum",
  year: 2006,
  genre: ["Comedy", "Family"],
  difficulty: 2,
  emojis: ["🏛️", "🦖", "🌙", "🕰️"],
  explanation: ["A museum comes alive after dark.", "Exhibits like dinosaurs roam free.", "Nighttime is when the magic happens.", "An ancient tablet powers the phenomenon."],
  aliases: []
},
{
  id: "the-sixth-sense",
  title: "The Sixth Sense",
  year: 1999,
  genre: ["Thriller", "Horror"],
  difficulty: 2,
  emojis: ["👻", "👦", "🩺", "🌡️"],
  explanation: ["A boy sees the dead.", "He confides his secret to a psychologist.", "Cold temperatures signal a ghostly presence.", "A shocking twist recontextualizes everything."],
  aliases: []
},
{
  id: "signs",
  title: "Signs",
  year: 2002,
  genre: ["Sci-Fi", "Thriller"],
  difficulty: 2,
  emojis: ["🌽", "⭕", "👽", "🥤"],
  explanation: ["Crop circles appear in the family's field.", "Strange patterns spread across the world.", "Extraterrestrials threaten the isolated farmhouse.", "Water becomes an unlikely weapon."],
  aliases: []
},
{
  id: "the-others",
  title: "The Others",
  year: 2001,
  genre: ["Horror", "Mystery"],
  difficulty: 3,
  emojis: ["🏚️", "🕯️", "👩", "🌫️"],
  explanation: ["A dark old mansion hides a secret.", "Candlelight is required due to photosensitivity.", "A mother protects her light-sensitive children.", "Fog shrouds the eerie grounds."],
  aliases: []
},
{
  id: "shutter-island",
  title: "Shutter Island",
  year: 2010,
  genre: ["Thriller", "Mystery"],
  difficulty: 3,
  emojis: ["🏝️", "🏥", "⛈️", "🕵️"],
  explanation: ["A remote island houses a mental facility.", "A U.S. Marshal investigates a disappearance.", "A storm isolates the island further.", "A shocking twist redefines the story."],
  aliases: []
},
{
  id: "gone-girl",
  title: "Gone Girl",
  year: 2014,
  genre: ["Thriller", "Mystery"],
  difficulty: 3,
  emojis: ["📓", "📺", "🔍", "💍"],
  explanation: ["A missing wife's diary raises suspicion.", "Media frenzy surrounds the case.", "Her husband becomes the prime suspect.", "Their marriage hides dark manipulation."],
  aliases: []
},
{
  id: "the-prestige",
  title: "The Prestige",
  year: 2006,
  genre: ["Mystery", "Drama"],
  difficulty: 3,
  emojis: ["🎩", "⚡", "🐦", "🪞"],
  explanation: ["Rival magicians compete for the ultimate trick.", "Tesla's electricity plays a mysterious role.", "A vanishing bird act recurs.", "Doubles and duplicates hide the secret."],
  aliases: []
},
{
  id: "memento",
  title: "Memento",
  year: 2000,
  genre: ["Thriller", "Mystery"],
  difficulty: 4,
  emojis: ["🧠", "📸", "🖋️", "⏪"],
  explanation: ["He cannot form new memories.", "Polaroids help him track clues.", "Tattoos serve as permanent notes.", "The story unfolds in reverse order."],
  aliases: []
},
{
  id: "the-usual-suspects",
  title: "The Usual Suspects",
  year: 1995,
  genre: ["Crime", "Mystery"],
  difficulty: 3,
  emojis: ["🕵️", "🔥", "👤", "☕"],
  explanation: ["Police interrogate a group of suspects.", "A boat explosion opens the mystery.", "A mysterious crime lord pulls the strings.", "A coffee cup detail unravels the twist."],
  aliases: []
},
{
  id: "die-hard-2",
  title: "Die Hard 2",
  year: 1990,
  genre: ["Action"],
  difficulty: 2,
  emojis: ["✈️", "❄️", "👮", "🔫"],
  explanation: ["An airport under siege is the setting.", "Snow blankets the wintry backdrop.", "The same off-duty cop returns.", "Terrorists again threaten innocent lives."],
  aliases: []
},
{
  id: "john-wick",
  title: "John Wick",
  year: 2014,
  genre: ["Action"],
  difficulty: 2,
  emojis: ["🐶", "🤵", "🔫", "🏨"],
  explanation: ["A beloved dog's fate sparks his rampage.", "A stylish suit is his signature look.", "Precise gunplay defines the action.", "A hidden hotel serves assassins by code."],
  aliases: []
},
{
  id: "the-matrix-reloaded",
  title: "The Matrix Reloaded",
  year: 2003,
  genre: ["Sci-Fi", "Action"],
  difficulty: 3,
  emojis: ["🕶️", "🥋", "🛣️", "🤖"],
  explanation: ["Sunglasses remain his signature look.", "Martial arts battles escalate further.", "A massive highway chase is a centerpiece.", "Duplicated agents multiply the threat."],
  aliases: []
},
{
  id: "men-in-black",
  title: "Men in Black",
  year: 1997,
  genre: ["Sci-Fi", "Comedy"],
  difficulty: 2,
  emojis: ["🕶️", "👽", "🚗", "🧠"],
  explanation: ["Sunglasses hide their secret identities.", "Aliens secretly live among humans.", "A flashy modified car aids their missions.", "Memory-erasing devices protect the secret."],
  aliases: []
},
{
  id: "independence-day",
  title: "Independence Day",
  year: 1996,
  genre: ["Sci-Fi", "Action"],
  difficulty: 2,
  emojis: ["🛸", "🏙️", "💥", "🎆"],
  explanation: ["Massive alien ships hover over cities.", "Landmarks are destroyed in the attack.", "Explosive battles fill the skies.", "The climax falls on the Fourth of July."],
  aliases: []
},
{
  id: "war-of-the-worlds",
  title: "War of the Worlds",
  year: 2005,
  genre: ["Sci-Fi", "Action"],
  difficulty: 3,
  emojis: ["🛸", "⚡", "👨‍👧", "🏚️"],
  explanation: ["Alien tripods emerge from underground.", "Lightning heralds their arrival.", "A father protects his children.", "Ruined towns mark their destructive path."],
  aliases: []
},
{
  id: "close-encounters",
  title: "Close Encounters of the Third Kind",
  year: 1977,
  genre: ["Sci-Fi"],
  difficulty: 3,
  emojis: ["🛸", "⛰️", "🎹", "💡"],
  explanation: ["A glowing UFO captivates witnesses.", "A mountain shape obsesses the protagonist.", "Musical tones become a form of communication.", "Bright lights signal the alien presence."],
  aliases: []
},
{
  id: "the-terminator",
  title: "The Terminator",
  year: 1984,
  genre: ["Sci-Fi", "Action"],
  difficulty: 2,
  emojis: ["🤖", "⏳", "🔫", "🕶️"],
  explanation: ["A relentless cyborg assassin is sent back.", "Time travel brings him to the present.", "He is armed and nearly unstoppable.", "Dark sunglasses define his cold look."],
  aliases: []
},
{
  id: "robocop",
  title: "RoboCop",
  year: 1987,
  genre: ["Sci-Fi", "Action"],
  difficulty: 3,
  emojis: ["👮", "🤖", "🔫", "🏙️"],
  explanation: ["A slain officer is rebuilt as a machine.", "Cybernetic armor grants him new power.", "He enforces the law with lethal force.", "A crime-ridden city needs his protection."],
  aliases: []
},
{
  id: "total-recall",
  title: "Total Recall",
  year: 1990,
  genre: ["Sci-Fi", "Action"],
  difficulty: 3,
  emojis: ["🧠", "🔴", "👽", "🏜️"],
  explanation: ["Implanted memories confuse reality.", "A trip to Mars is central to the plot.", "Mutants populate the colonized planet.", "The red planet's landscape dominates the film."],
  aliases: []
},
{
  id: "minority-report",
  title: "Minority Report",
  year: 2002,
  genre: ["Sci-Fi", "Thriller"],
  difficulty: 3,
  emojis: ["👁️", "🔮", "🚓", "🖐️"],
  explanation: ["Psychics predict crimes before they happen.", "Precogs foresee the future in visions.", "Police arrest suspects before any crime occurs.", "Gesture-based technology controls the interface."],
  aliases: []
},
{
  id: "edge-of-tomorrow",
  title: "Edge of Tomorrow",
  year: 2014,
  genre: ["Sci-Fi", "Action"],
  difficulty: 3,
  emojis: ["🔁", "🪖", "👽", "⏰"],
  explanation: ["A soldier relives the same battle endlessly.", "Armored exosuits equip the fighters.", "Alien invaders threaten humanity's survival.", "Each death resets the day like an alarm clock."],
  aliases: []
},
{
  id: "looper",
  title: "Looper",
  year: 2012,
  genre: ["Sci-Fi", "Thriller"],
  difficulty: 3,
  emojis: ["🔫", "⏳", "👶", "🤝"],
  explanation: ["Assassins eliminate targets sent from the future.", "Time travel is illegal but exploited.", "A powerful child becomes central to the plot.", "He must confront his own future self."],
  aliases: []
},
{
  id: "her",
  title: "Her",
  year: 2013,
  genre: ["Sci-Fi", "Romance"],
  difficulty: 3,
  emojis: ["📱", "💬", "💕", "🎧"],
  explanation: ["An operating system becomes his companion.", "Conversations form the core of their bond.", "He falls in love with an artificial voice.", "Earbuds keep her constantly present."],
  aliases: []
},
{
  id: "children-of-men",
  title: "Children of Men",
  year: 2006,
  genre: ["Sci-Fi", "Drama"],
  difficulty: 3,
  emojis: ["🤰", "🌍", "🔫", "🚗"],
  explanation: ["Global infertility defines the crisis.", "Society has collapsed into chaos.", "Armed conflict fills the dystopian streets.", "A dangerous journey protects the one pregnant woman."],
  aliases: []
},
{
  id: "district-9",
  title: "District 9",
  year: 2009,
  genre: ["Sci-Fi"],
  difficulty: 3,
  emojis: ["🛸", "👽", "🏚️", "🔫"],
  explanation: ["A stranded alien ship hovers over the city.", "Refugee aliens are confined to slums.", "Segregated camps define their treatment.", "A bureaucrat's transformation drives the plot."],
  aliases: []
},
{
  id: "moon-2009",
  title: "Moon",
  year: 2009,
  genre: ["Sci-Fi", "Drama"],
  difficulty: 4,
  emojis: ["🌕", "🤖", "😴", "👤"],
  explanation: ["A lunar mining base is the setting.", "A robotic assistant aids the lone worker.", "Isolation weighs on his fragile mind.", "A duplicate of himself unravels the mystery."],
  aliases: []
},
{
  id: "tenet",
  title: "Tenet",
  year: 2020,
  genre: ["Sci-Fi", "Action"],
  difficulty: 4,
  emojis: ["⏪", "🎩", "💣", "🌀"],
  explanation: ["Time runs backward for some objects.", "A sharp-suited operative leads the mission.", "Reversed explosions defy normal physics.", "A temporal pincer maneuver resolves the climax."],
  aliases: []
},
{
  id: "dune-part-two",
  title: "Dune: Part Two",
  year: 2024,
  genre: ["Sci-Fi"],
  difficulty: 2,
  emojis: ["🏜️", "🐛", "⚔️", "👑"],
  explanation: ["The desert planet's story continues.", "Riding a sandworm becomes a rite of passage.", "War erupts across the sands.", "A prophesied leader rises to power."],
  aliases: []
},
{
  id: "glass-onion",
  title: "Glass Onion: A Knives Out Mystery",
  year: 2022,
  genre: ["Mystery", "Comedy"],
  difficulty: 2,
  emojis: ["🧅", "🏝️", "🕵️", "💎"],
  explanation: ["Layers of deception mirror the title's imagery.", "A private Greek island hosts the mystery.", "The folksy detective returns to solve it.", "A billionaire's puzzle party goes wrong."],
  aliases: []
},
{
  id: "moonrise-kingdom",
  title: "Moonrise Kingdom",
  year: 2012,
  genre: ["Comedy", "Romance"],
  difficulty: 3,
  emojis: ["🏕️", "💌", "🧭", "⛈️"],
  explanation: ["Two young runaways camp in the wilderness.", "Secret letters spark their romance.", "A compass guides their escape.", "A storm threatens to end their adventure."],
  aliases: []
},
{
  id: "lost-in-translation",
  title: "Lost in Translation",
  year: 2003,
  genre: ["Drama", "Comedy"],
  difficulty: 3,
  emojis: ["🏨", "🌆", "🎤", "🍶"],
  explanation: ["A Tokyo hotel connects two lonely strangers.", "Neon city lights surround them at night.", "A karaoke night brings them closer.", "A quiet, wistful bond forms between them."],
  aliases: []
},
{
  id: "nope",
  title: "Nope",
  year: 2022,
  genre: ["Horror", "Sci-Fi"],
  difficulty: 3,
  emojis: ["🐴", "🛸", "👁️", "🎪"],
  explanation: ["Horse wranglers work beneath a strange sky.", "An unidentified craft looms overhead.", "Looking directly at it proves dangerous.", "A theme park attraction becomes the site of horror."],
  aliases: []
}
];
