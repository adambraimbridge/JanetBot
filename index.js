if (process.env.NODE_ENV !== 'production') require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();
const bodyParser = require('body-parser');
const basicAuth = require('express-basic-auth');
const authUser = process.env.AUTH_USER;
const credentials = {};
credentials[authUser] = process.env.AUTH_TOKEN;

const results = {};
const totals = {
	'uk': {},
	'international': {}
};

let latestCheck;

const homepagecontent = require('./bin/lib/homepage');
const Utils  = require('./bin/lib/utils');
const janetBot = require('./bin/lib/bot').init();
const feedbackStore = require('./bin/lib/dynamo');
const { editions } = require('./bin/lib/page-structure');

const pollInterval = Utils.minutesToMs(process.env.POLLING_INTERVAL_MINUTES);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});


app.post('/feedback', (req, res) => {
	const update = Utils.sanitiseNull(req.body);

	feedbackStore.write(update, process.env.AWS_TABLE)
	.then(response => {
		updateResults(update);
		return res.status(200).end();
	})
	.catch(err => {
		console.log('Saving failed', err);
		return res.status(400).end();
	});
});

app.get('/results/:version', basicAuth({
		users: credentials
	}), (req, res) => {
	if(results[req.params.version]) {
		res.json({'status': 200, 'content': results[req.params.version], 'total': totals[req.params.version], 'date': latestCheck});	
	} else if(req.params.version === 'all'){
		res.json({'status': 200, 'content': results, 'total': totals, 'date': latestCheck});	
	} else {
		res.json({'status': 404});
	}
});

app.listen(process.env.PORT || 2018);

function updateResults(image) {
	console.log('Feedback completed', image);

	const edition = image.edition;
	const toUpdate = results[edition].findIndex(img => {
		return img.articleUUID === image.articleUUID && img.formattedURL === image.formattedURL;
	});

	results[edition][toUpdate] = Utils.parseNull(image);
	results[edition].resultFromAPI = false;

	updateTotals(edition);
}

function updateTotals(edition) {
	//TODO: what if the same image is on the other edition??
	let score = 0;
	let scoreTopHalf = 0;

	results[edition].forEach( item => {
		if(item.classification === 'woman') {
			++score;

			if(item.isTopHalf) {
				++scoreTopHalf;
			}
		}
	});

	totals[edition]['women'] = score;
	totals[edition]['topHalfWomen'] = scoreTopHalf;
}

async function getContent() {
	// for(let i = 0; i < editions.length; ++ i) {	
	// 	const edition = editions[i];
	// 	const imageData =  await homepagecontent.frontPage(edition);
	// 	// console.log(`${edition.toUpperCase()} HOMEPAGE', imageData.length, imageData);
	// 	totals[edition]['women'] = 0;
	// 	totals[edition]['topHalfWomen'] = 0;	
	// 	totals[edition]['images'] = imageData.length;
	// 	results[edition] = await analyseContent(imageData, edition);

	// 	// janetBot.warn(`There are ${imageData.length} images on the ${edition.toUpperCase()} Homepage.`);
	// }

	janetBot.warn("I am working in multiple channels");

	latestCheck = new Date();
}

async function analyseContent(content, editionKey) {
	for(let i = 0; i < content.length; ++i) {
		//Add mock result until API ready

		const checkDB = await feedbackStore.scan({articleUUID: content[i].articleUUID, originalUrl: content[i].originalUrl}, process.env.AWS_TABLE)
		.then(res => {
			if(res.Count > 0) {
				const items = Utils.sort(res.Items, 'correctionTime', 'desc');
				content[i].classification = items[0].classification;
				content[i].resultFromAPI = false;

			} else {
				const mockResult = content[i].articleUUID.slice(-1);
				content[i].classification = (mockResult === '2')?'woman':(Math.floor(Math.random()*1000)%4 === 0)?'man':'undefined';
				content[i].resultFromAPI = true;
			}

			if(content[i].classification === 'woman') {
				totals[editionKey]['women'] += 1;
				
				if(content[i].isTopHalf) {
					totals[editionKey]['topHalfWomen'] += 1;
				}
			}
		})
		.catch(err => console.log(err));
	}

	return content;
}

getContent();
setInterval(getContent, pollInterval);