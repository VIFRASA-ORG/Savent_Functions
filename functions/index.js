const functions = require("firebase-functions");

// The Firebase Admin SDK to access Firestore.
const admin = require('firebase-admin');
admin.initializeApp();



/* Listens for a change into the event collection
 * Function called every time an event is updated.
 *
 **/
exports.ClimbEventQueue = functions.firestore.document('Eventi/{idEvento}')
	.onUpdate(async (change, context) => {
		const oldEvent = change.before.data();
		const newEvent = change.after.data();

		functions.logger.log("ClimbEventQueue","Executed now");

		//In case someone has left the event and there is someone in the queue
		if((newEvent.numeroPartecipanti < oldEvent.numeroPartecipanti || newEvent.numeroMassimoPartecipanti > oldEvent.numeroMassimoPartecipanti) && newEvent.numeroPartecipantiInCoda > 0){
			
			//We have find the first person in the queue
			const db = admin.firestore();

			//Find the maximum number of person that is possible to shift
			const maxNumOfShift = newEvent.numeroMassimoPartecipanti - newEvent.numeroPartecipanti;

			//Executing the query to find all the person that is possible to shift
			const firstPersonInQueue = await db.collection("Partecipazioni").where("idEvento","==",context.params.idEvento).where("accettazione","==",true).where("listaAttesa","==",true).orderBy("dataOra").limit(maxNumOfShift).get();

			functions.logger.log("ClimbEventQueue","Query executed");

			if(!firstPersonInQueue.empty){
				let partecipations = [];

				firstPersonInQueue.forEach(doc => partecipations.push(doc));
				functions.logger.log("ClimbEventQueue",partecipations.length);


				if(partecipations.length > 0){
					//Partecipation found

					partecipations.forEach(async partecipation => {
						functions.logger.log("ClimbEventQueue", partecipation);

						// Get a new write batch
						const batch = db.batch();

						//We have to update the listaAttesa flag of the partecipation
						batch.update(db.collection("Partecipazioni").doc(partecipation.id),{listaAttesa: false});

						//Update the number of partecipant of the event and the number of the people in queue
						batch.update(db.collection("Eventi").doc(context.params.idEvento),{numeroPartecipanti: admin.firestore.FieldValue.increment(1)});
						batch.update(db.collection("Eventi").doc(context.params.idEvento),{numeroPartecipantiInCoda: admin.firestore.FieldValue.increment(-1)});

						// Commit the batch
						await batch.commit();

						functions.logger.log("ClimbEventQueue", partecipation.idUtente);
						const part = partecipation.data()

						//Send the notification to the user
						const tokenRef = db.collection("MessagingToken").doc(part.idUtente);
						const doc = await tokenRef.get();
						if (!doc.exists) {
						  	console.log('No token for the user: ', part.idUtente);
						} else {
							const messToken = doc.data();
							console.log('Token found for the user: ', part.idUtente);

							//Formatting the payload
							const payload = {
								token: token,
							    data: {
							        notificationType: notificationType,
							        eventId: eventId,
							        eventName: eventName,
							    }
							};

							sendNotification(payload);
						}

					});
				}
			}

		}
	});


/**
 * Function used to send a notification.
 * The payload has to be an object with inside at least the token of the user:
 * const payload = {
 * 		token: "jnbfwkne",
 * 		data: {
 * 			......
 * 		}
 * }
 * 
 **/
function sendNotification(payload){
	admin.messaging().send(payload).then((response) => {
	    // Response is a message ID string.
	    console.log('Successfully sent message:', response);
	    return {success: true};
	}).catch((error) => {
	    return {error: error.code};
	});
}














